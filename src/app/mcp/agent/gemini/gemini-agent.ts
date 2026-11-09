import { Service, inject } from '@angular/core';
import { CLOCK } from '../../../core/util/clock';
import { redactSecrets, type TokenUsage } from '../../telemetry/wire-packet';
import { WireTelemetryStore } from '../../telemetry/wire-telemetry-store';
import { AGENT_CONFIG } from '../agent-config';
import type { AgentErrorKind, AgentEvent } from '../agent-events';
import { diffTools, McpToolGateway } from '../mcp-tool-gateway';
import { buildSystemPrompt } from '../system-prompt';
import { estimateCostUsd, findModel } from './gemini-models';
import {
  GENAI_CLIENT_FACTORY,
  type GenAiConfig,
  type GenAiFunctionCall,
  type GenAiPart,
  type GenAiUsage,
} from './genai-client';
import { toFunctionDeclarations, toFunctionResponse } from './tool-adapter';

export const MAX_AGENT_STEPS = 8;
export const NEXT_TOOL_WAIT_MS = 3000;
export const STREAM_STALL_MS = 45_000;

export interface AgentRunOptions {
  signal: AbortSignal;
  model?: string;
  maxSteps?: number;
  runId?: string;
  stallMs?: number;
}

export interface ClassifiedError {
  kind: AgentErrorKind;
  message: string;
}

function readStatus(error: unknown): number | undefined {
  const status = (error as { status?: unknown } | null)?.status;
  return typeof status === 'number' ? status : undefined;
}

function readMessage(error: unknown): string {
  const raw = error instanceof Error ? error.message : String(error);
  try {
    const parsed = JSON.parse(raw) as { error?: { message?: unknown } };
    if (typeof parsed.error?.message === 'string') {
      return parsed.error.message;
    }
  } catch {
    return raw;
  }
  return raw;
}

const MODEL_PROBLEM = /model|not found|not supported|not available|billing|access to/i;
const KEY_PROBLEM = /api key|credential|unregistered callers|permission/i;

export function classifyError(error: unknown): ClassifiedError {
  const status = readStatus(error);
  const message = readMessage(error);
  if (status === 429) {
    return { kind: 'quota', message };
  }
  if (status === 404) {
    return { kind: 'model-access', message };
  }
  if (status === 401) {
    return { kind: 'auth', message };
  }
  if (status === 403) {
    return {
      kind: MODEL_PROBLEM.test(message) && !KEY_PROBLEM.test(message) ? 'model-access' : 'auth',
      message,
    };
  }
  if (status === 400 && /api key/i.test(message)) {
    return { kind: 'auth', message };
  }
  if (
    status === undefined &&
    (error instanceof TypeError || /failed to fetch|network/i.test(message))
  ) {
    return { kind: 'network', message };
  }
  return { kind: 'unknown', message };
}

export function isAbort(error: unknown, signal: AbortSignal): boolean {
  return signal.aborted || (error as { name?: unknown } | null)?.name === 'AbortError';
}

function usageOf(metadata: GenAiUsage | undefined): TokenUsage {
  return {
    input: (metadata?.promptTokenCount ?? 0) + (metadata?.toolUsePromptTokenCount ?? 0),
    output: metadata?.candidatesTokenCount ?? 0,
    thinking: metadata?.thoughtsTokenCount ?? 0,
  };
}

function announcedTool(result: unknown): string | null {
  const next = (result as { nextTool?: unknown } | null)?.nextTool;
  return typeof next === 'string' ? next : null;
}

@Service()
export class GeminiAgent {
  private readonly gateway = inject(McpToolGateway);
  private readonly config = inject(AGENT_CONFIG);
  private readonly createClient = inject(GENAI_CLIENT_FACTORY);
  private readonly telemetry = inject(WireTelemetryStore);
  private readonly clock = inject(CLOCK);

  async *run(prompt: string, options: AgentRunOptions): AsyncGenerator<AgentEvent> {
    const { signal } = options;
    const apiKey = this.config.apiKey();
    const modelId = options.model ?? this.config.model();
    const maxSteps = options.maxSteps ?? MAX_AGENT_STEPS;
    const startedAt = this.clock().getTime();
    const stallMs = options.stallMs ?? STREAM_STALL_MS;
    const totals: TokenUsage = { input: 0, output: 0, thinking: 0 };
    let inflight: GenAiUsage | undefined;
    let stalled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const stall = new AbortController();
    const stepSignal = AbortSignal.any([signal, stall.signal]);
    const arm = () => {
      clearTimeout(timer);
      timer = setTimeout(() => {
        stalled = true;
        stall.abort();
      }, stallMs);
    };
    const addUsage = (usage: TokenUsage) => {
      totals.input += usage.input;
      totals.output += usage.output;
      totals.thinking += usage.thinking;
    };
    const finish = (partial: boolean): AgentEvent => ({
      type: 'done',
      usage: { ...totals },
      costUsd: estimateCostUsd(modelId, totals, this.clock()) ?? 0,
      model: modelId,
      ms: this.clock().getTime() - startedAt,
      ...(partial && { partial: true }),
    });
    const thinkingLevel = findModel(modelId)?.thinkingLevel.toUpperCase();

    const configFor = (declarations: ReturnType<typeof toFunctionDeclarations>): GenAiConfig => ({
      systemInstruction: buildSystemPrompt(this.clock()),
      tools: declarations.length > 0 ? [{ functionDeclarations: declarations }] : [],
      thinkingConfig: { ...(thinkingLevel && { thinkingLevel }), includeThoughts: true },
      automaticFunctionCalling: { disable: true },
    });

    let tools = await this.gateway.listTools();
    let knownVersion = this.gateway.toolsVersion();
    let declarations = toFunctionDeclarations(tools);

    let message: GenAiPart[] = [{ text: prompt }];
    let packetId = 0;
    let finished = false;

    try {
      const client = await this.createClient(apiKey);
      const chat = client.chats.create({ model: modelId, config: configFor(declarations) });

      for (let step = 1; step <= maxSteps; step++) {
        if (signal.aborted) {
          yield finish(true);
          return;
        }
        if (this.gateway.toolsVersion() !== knownVersion) {
          knownVersion = this.gateway.toolsVersion();
          const before = tools.map((tool) => tool.name);
          tools = await this.gateway.listTools();
          declarations = toFunctionDeclarations(tools);
          const { added, removed } = diffTools(
            before,
            tools.map((tool) => tool.name),
          );
          if (added.length > 0 || removed.length > 0) {
            yield { type: 'tools-changed', added, removed };
          }
        }

        const stepStartedAt = this.clock().getTime();
        packetId = this.telemetry.begin({
          channel: 'llm',
          method: 'generateContent',
          model: modelId,
          ...(options.runId !== undefined && { runId: options.runId }),
          params: { model: modelId, step, thinkingLevel, tools: tools.length, message },
        });

        arm();
        const stream = await chat.sendMessageStream({
          message,
          config: { ...configFor(declarations), abortSignal: stepSignal },
        });

        const calls: GenAiFunctionCall[] = [];
        let text = '';
        let thoughts = 0;
        let metadata: GenAiUsage | undefined;
        for await (const chunk of stream) {
          clearTimeout(timer);
          if (chunk.usageMetadata) {
            metadata = chunk.usageMetadata;
            inflight = metadata;
          }
          for (const part of chunk.candidates?.[0]?.content?.parts ?? []) {
            if (part.functionCall) {
              calls.push(part.functionCall);
            } else if (part.text) {
              if (part.thought) {
                thoughts++;
                yield { type: 'thought', text: part.text };
              } else {
                text += part.text;
                yield { type: 'text-delta', text: part.text };
              }
            }
          }
          arm();
        }
        clearTimeout(timer);

        const usage = usageOf(metadata);
        inflight = undefined;
        addUsage(usage);
        const cost = estimateCostUsd(modelId, usage, this.clock());
        this.telemetry.end(packetId, {
          status: 'ok',
          latencyMs: this.clock().getTime() - stepStartedAt,
          model: modelId,
          tokens: usage,
          ...(cost !== undefined && { costUsd: cost }),
          result: {
            text,
            thoughts,
            functionCalls: calls.map((call) => ({ name: call.name, args: call.args })),
          },
        });
        packetId = 0;

        if (calls.length === 0) {
          finished = true;
          break;
        }

        const responses: GenAiPart[] = [];
        for (const [index, call] of calls.entries()) {
          const callId = call.id ?? `step-${step}-call-${index}`;
          const name = call.name ?? '';
          const args = call.args ?? {};
          yield { type: 'tool-call', callId, name, args };
          const result = await this.gateway.callTool(name, args, signal);
          if (signal.aborted) {
            yield finish(true);
            return;
          }
          yield {
            type: 'tool-result',
            callId,
            name,
            result: result.result,
            ok: result.ok,
            latencyMs: result.latencyMs,
          };
          responses.push(toFunctionResponse({ ...call, id: callId }, result));
          const next = result.ok ? announcedTool(result.result) : null;
          if (next) {
            await this.gateway.waitForTool(next, NEXT_TOOL_WAIT_MS, signal);
          }
        }
        message = responses;
      }

      if (!finished) {
        yield {
          type: 'error',
          kind: 'max-steps',
          message: `Stopped after ${maxSteps} steps without a final answer`,
        };
      }
      yield finish(false);
    } catch (error) {
      clearTimeout(timer);
      const timedOut = stalled && !signal.aborted;
      const aborted = !timedOut && isAbort(error, signal);
      const classified = timedOut
        ? {
            kind: 'network' as const,
            message: `No response from Gemini for ${Math.round(stallMs / 1000)}s. Check your connection and try again.`,
          }
        : classifyError(error);
      const safe = redactSecrets(classified.message, [apiKey]);
      if (inflight) {
        addUsage(usageOf(inflight));
        inflight = undefined;
      }
      if (packetId !== 0) {
        this.telemetry.end(packetId, { status: 'error', error: aborted ? 'aborted' : safe });
        packetId = 0;
      }
      if (!aborted) {
        yield { type: 'error', kind: classified.kind, message: safe };
      }
      yield finish(true);
    } finally {
      clearTimeout(timer);
      if (packetId !== 0) {
        this.telemetry.end(packetId, { status: 'error', error: 'aborted' });
      }
    }
  }
}
