import { Injector, declareExperimentalWebMcpTool, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import {
  FakeApiError,
  FakeGenAI,
  fakeGenAiFactory,
  type FakeScript,
} from '../../../../testing/fake-genai';
import { useFakeModelContext } from '../../../../testing/test-providers';
import { CLOCK } from '../../../core/util/clock';
import { WIRE_SECRETS, WireTelemetryStore } from '../../telemetry/wire-telemetry-store';
import { defineTool } from '../../tooling/define-tool';
import { HUMAN_APPROVAL_GATE } from '../../tooling/approval-gate';
import { AGENT_CONFIG } from '../agent-config';
import type { AgentEvent } from '../agent-events';
import { McpToolGateway } from '../mcp-tool-gateway';
import { estimateCostUsd } from './gemini-models';
import { GENAI_CLIENT_FACTORY } from './genai-client';
import {
  GeminiAgent,
  MAX_AGENT_STEPS,
  classifyError,
  isAbort,
  type AgentRunOptions,
} from './gemini-agent';

const KEY = 'AIza-secret-key-0001';
const text = (value: unknown) => ({ content: [{ type: 'text', text: JSON.stringify(value) }] });

async function collect(stream: AsyncIterable<AgentEvent>): Promise<AgentEvent[]> {
  const events: AgentEvent[] = [];
  for await (const event of stream) {
    events.push(event);
  }
  return events;
}

describe('GeminiAgent', () => {
  const registry = useFakeModelContext();
  const model = signal('gemini-3.8-flash');
  let tick = 0;

  function setup(script: FakeScript[] = []) {
    tick = 0;
    model.set('gemini-3.8-flash');
    const fake = new FakeGenAI(script);
    TestBed.configureTestingModule({
      providers: [
        { provide: GENAI_CLIENT_FACTORY, useValue: fakeGenAiFactory(fake) },
        { provide: AGENT_CONFIG, useValue: { apiKey: signal(KEY), model } },
        { provide: WIRE_SECRETS, useValue: () => [KEY] },
        {
          provide: CLOCK,
          useValue: () => new Date(Date.parse('2026-11-09T10:00:00Z') + (tick += 10)),
        },
      ],
    });
    return {
      fake,
      agent: TestBed.inject(GeminiAgent),
      telemetry: TestBed.inject(WireTelemetryStore),
      gateway: TestBed.inject(McpToolGateway),
    };
  }

  function register(name: string, execute: (args: never) => unknown = () => text({ ok: true })) {
    registry.current.registerTool({
      name,
      description: `${name} tool`,
      inputSchema: { type: 'object', properties: {} },
      execute,
    });
  }

  const run = (agent: GeminiAgent, prompt = 'Hello', options: Partial<AgentRunOptions> = {}) =>
    collect(agent.run(prompt, { signal: new AbortController().signal, ...options }));

  describe('conversation', () => {
    it('streams text deltas in order and finishes with done', async () => {
      const { agent } = setup([{ text: ['Pipe', 'line ', 'is healthy'] }]);
      const events = await run(agent);
      expect(events.flatMap((e) => (e.type === 'text-delta' ? [e.text] : []))).toEqual([
        'Pipe',
        'line ',
        'is healthy',
      ]);
      expect(events.at(-1)).toMatchObject({ type: 'done', model: 'gemini-3.8-flash' });
    });

    it('emits thoughts before the answer', async () => {
      const { agent } = setup([{ thoughts: ['Plan A', 'Plan B'], text: 'Answer' }]);
      const events = await run(agent);
      expect(events.map((e) => e.type)).toEqual(['thought', 'thought', 'text-delta', 'done']);
      expect(events[0]).toMatchObject({ text: 'Plan A' });
    });

    it('sends the prompt as the first user message', async () => {
      const { agent, fake } = setup([{ text: 'ok' }]);
      await run(agent, 'Summarise the pipeline');
      expect(fake.requests[0]?.message).toEqual([{ text: 'Summarise the pipeline' }]);
    });

    it('sends each tool result back on the same chat and keeps the history', async () => {
      register('getPipelineSummary', () => text({ total: 24 }));
      const { agent, fake } = setup([
        { functionCalls: [{ name: 'getPipelineSummary', id: 'c1' }] },
        { text: 'You have 24 deals.' },
      ]);
      const events = await run(agent, 'How many deals?');

      expect(fake.createdChats).toHaveLength(1);
      expect(fake.requests.map((request) => request.chat)).toEqual([
        fake.createdChats[0],
        fake.createdChats[0],
      ]);
      expect(fake.requests[1]?.message).toEqual([
        {
          functionResponse: {
            id: 'c1',
            name: 'getPipelineSummary',
            response: { output: { total: 24 } },
          },
        },
      ]);
      const history = fake.createdChats[0]!.history;
      expect(history.map((entry) => entry.role)).toEqual(['user', 'model', 'user', 'model']);
      expect(history[1]?.parts[0]).toMatchObject({
        functionCall: { name: 'getPipelineSummary' },
        thoughtSignature: expect.stringMatching(/^sig-/),
      });
      expect(events.map((e) => e.type)).toEqual(['tool-call', 'tool-result', 'text-delta', 'done']);
      expect(events[1]).toMatchObject({ ok: true, result: { total: 24 }, callId: 'c1' });
    });

    it('runs parallel calls in the order the model asked for them', async () => {
      const order: string[] = [];
      register('first', () => {
        order.push('first');
        return text(1);
      });
      register('second', () => {
        order.push('second');
        return text(2);
      });
      const { agent, fake } = setup([
        { functionCalls: [{ name: 'second' }, { name: 'first' }] },
        { text: 'done' },
      ]);
      const events = await run(agent);
      expect(order).toEqual(['second', 'first']);
      expect(
        events.map((e) =>
          e.type === 'tool-call' || e.type === 'tool-result' ? `${e.type}:${e.name}` : e.type,
        ),
      ).toEqual([
        'tool-call:second',
        'tool-result:second',
        'tool-call:first',
        'tool-result:first',
        'text-delta',
        'done',
      ]);
      expect(fake.requests[1]?.message.map((part) => part.functionResponse?.name)).toEqual([
        'second',
        'first',
      ]);
    });

    it('reports a failing or unknown tool back to the model as an error', async () => {
      const { agent, fake } = setup([
        { functionCalls: [{ name: 'doesNotExist' }, { id: 'x' } as never] },
        { text: 'sorry' },
      ]);
      const events = await run(agent);
      const results = events.flatMap((e) => (e.type === 'tool-result' ? [e.ok] : []));
      expect(results).toEqual([false, false]);
      expect(fake.requests[1]?.message[0]?.functionResponse?.response).toHaveProperty('error');
    });
  });

  describe('tool discovery', () => {
    it('lists the tools once on start as a tools/list packet', async () => {
      register('alpha');
      const { agent, telemetry } = setup([{ text: 'hi' }]);
      await run(agent);
      expect(telemetry.entities().filter((p) => p.method === 'tools/list')).toHaveLength(1);
    });

    it('declares the registry tools with their schemas', async () => {
      register('alpha');
      const { agent, fake } = setup([{ text: 'hi' }]);
      await run(agent);
      expect(fake.requests[0]?.config?.tools?.[0]?.functionDeclarations.map((d) => d.name)).toEqual(
        ['alpha'],
      );
    });

    it('sends no tools block when the registry is empty', async () => {
      const { agent, fake } = setup([{ text: 'hi' }]);
      await run(agent);
      expect(fake.requests[0]?.config?.tools).toEqual([]);
    });

    it('refreshes the tools after a toolchange and reports the difference', async () => {
      register('openDrawer', () => {
        register('draftForm');
        return text({ opened: true });
      });
      const { agent, fake } = setup([
        { functionCalls: [{ name: 'openDrawer' }] },
        { text: 'now I can draft' },
      ]);
      const events = await run(agent);

      const names = (index: number) =>
        fake.requests[index]?.config?.tools?.[0]?.functionDeclarations.map((d) => d.name);
      expect(names(0)).toEqual(['openDrawer']);
      expect(names(1)).toEqual(['draftForm', 'openDrawer']);
      expect(events).toContainEqual({ type: 'tools-changed', added: ['draftForm'], removed: [] });
    });

    it('waits for the tool a result announces as nextTool', async () => {
      register('openDrawer', () => {
        setTimeout(() => register('lateForm'), 15);
        return text({ opened: true, nextTool: 'lateForm' });
      });
      const { agent, fake } = setup([{ functionCalls: [{ name: 'openDrawer' }] }, { text: 'ok' }]);
      await run(agent);
      expect(
        fake.requests[1]?.config?.tools?.[0]?.functionDeclarations.map((d) => d.name),
      ).toContain('lateForm');
    });
  });

  describe('limits and abort', () => {
    it('stops after 8 steps with a max-steps error', async () => {
      register('loop');
      const { agent, fake } = setup(
        Array.from({ length: 12 }, () => ({ functionCalls: [{ name: 'loop' }] })),
      );
      const events = await run(agent);
      expect(MAX_AGENT_STEPS).toBe(8);
      expect(fake.requests).toHaveLength(8);
      expect(events.at(-2)).toMatchObject({ type: 'error', kind: 'max-steps' });
      expect(events.at(-1)?.type).toBe('done');
    });

    it('honours a lower step limit', async () => {
      register('loop');
      const { agent, fake } = setup(
        Array.from({ length: 5 }, () => ({ functionCalls: [{ name: 'loop' }] })),
      );
      await run(agent, 'go', { maxSteps: 2 });
      expect(fake.requests).toHaveLength(2);
    });

    it('does nothing when aborted before it starts', async () => {
      const { agent, fake } = setup([{ text: 'never' }]);
      const controller = new AbortController();
      controller.abort();
      const events = await collect(agent.run('hi', { signal: controller.signal }));
      expect(events).toEqual([]);
      expect(fake.requests).toHaveLength(0);
    });

    it('stops requesting once aborted during a tool call', async () => {
      const controller = new AbortController();
      register('slow', () => {
        controller.abort();
        return text({ ok: true });
      });
      const { agent, fake } = setup([{ functionCalls: [{ name: 'slow' }] }, { text: 'late' }]);
      const events = await collect(agent.run('go', { signal: controller.signal }));
      expect(fake.requests).toHaveLength(1);
      expect(events.map((e) => e.type)).toEqual(['tool-call']);
    });

    it('aborts a response that is still streaming and settles its packet', async () => {
      const controller = new AbortController();
      const { agent, fake, telemetry } = setup([{ text: 'x', hold: new Promise(() => undefined) }]);
      const pending = collect(agent.run('go', { signal: controller.signal }));
      await vi.waitFor(() => expect(fake.requests).toHaveLength(1));
      controller.abort();
      expect(await pending).toEqual([]);
      const packet = telemetry.entities().find((p) => p.method === 'generateContent');
      expect(packet).toMatchObject({ status: 'error' });
      expect(packet?.envelope.response?.error?.message).toBe('aborted');
    });

    it('passes the abort signal to the pending human approval', async () => {
      const controller = new AbortController();
      const seen: AbortSignal[] = [];
      const gate = {
        pending: signal(null),
        request: (_: unknown, abort: AbortSignal) =>
          new Promise((resolve) => {
            seen.push(abort);
            abort.addEventListener('abort', () => resolve({ approved: false, note: 'aborted' }));
          }),
      };
      TestBed.configureTestingModule({
        providers: [{ provide: HUMAN_APPROVAL_GATE, useValue: gate }],
      });
      const tool = defineTool<Record<string, never>>({
        name: 'risky',
        description: 'x',
        inputSchema: { type: 'object', additionalProperties: false },
        risk: () => ({ toolName: 'risky', risk: 'high', summary: 'Risky' }),
        run: () => ({ done: true }),
      });
      const { agent, fake } = setup([{ functionCalls: [{ name: 'risky' }] }, { text: 'late' }]);
      await declareExperimentalWebMcpTool(tool, TestBed.inject(Injector));

      const pending = collect(agent.run('go', { signal: controller.signal }));
      await vi.waitFor(() => expect(seen).toHaveLength(1));
      controller.abort();
      await pending;
      expect(seen[0]?.aborted).toBe(true);
      expect(fake.requests).toHaveLength(1);
    });
  });

  describe('model configuration and usage', () => {
    it('creates the chat with the configured model and thinking level', async () => {
      const { agent, fake } = setup([{ text: 'hi' }]);
      await run(agent);
      const chat = fake.createdChats[0]!;
      expect(chat.model).toBe('gemini-3.8-flash');
      expect(chat.createConfig).toMatchObject({
        thinkingConfig: { thinkingLevel: 'MEDIUM', includeThoughts: true },
        automaticFunctionCalling: { disable: true },
      });
      expect(chat.createConfig?.systemInstruction).toContain('Today is 2026-11-09.');
    });

    it('repeats the whole config on every request, with the abort signal', async () => {
      register('loop');
      const controller = new AbortController();
      const { agent, fake } = setup([{ functionCalls: [{ name: 'loop' }] }, { text: 'ok' }]);
      await collect(agent.run('go', { signal: controller.signal }));
      for (const request of fake.requests) {
        expect(request.config).toMatchObject({
          thinkingConfig: { thinkingLevel: 'MEDIUM', includeThoughts: true },
          automaticFunctionCalling: { disable: true },
          abortSignal: controller.signal,
        });
        expect(request.config?.systemInstruction).toBeTruthy();
      }
    });

    it('lets a run pick another model and maps its thinking level', async () => {
      const { agent, fake } = setup([{ text: 'hi' }]);
      const events = await run(agent, 'go', { model: 'gemini-4-argon' });
      expect(fake.createdChats[0]?.model).toBe('gemini-4-argon');
      expect(fake.requests[0]?.config?.thinkingConfig?.thinkingLevel).toBe('HIGH');
      expect(events.at(-1)).toMatchObject({ model: 'gemini-4-argon' });
    });

    it('follows the configured model when none is given', async () => {
      model.set('gemini-3.5-flash-lite');
      const { agent, fake } = setup([{ text: 'hi' }]);
      model.set('gemini-3.5-flash-lite');
      await run(agent);
      expect(fake.createdChats[0]?.model).toBe('gemini-3.5-flash-lite');
      expect(fake.requests[0]?.config?.thinkingConfig?.thinkingLevel).toBe('LOW');
    });

    it('omits the thinking level for a model it does not know', async () => {
      const { agent, fake } = setup([{ text: 'hi' }]);
      const events = await run(agent, 'go', { model: 'gemini-future' });
      expect(fake.requests[0]?.config?.thinkingConfig).toEqual({ includeThoughts: true });
      expect(events.at(-1)).toMatchObject({ type: 'done', costUsd: 0 });
    });

    it('sums usage across steps, counts thinking as output cost and records packets', async () => {
      register('loop');
      const { agent, telemetry } = setup([
        {
          functionCalls: [{ name: 'loop' }],
          usage: { promptTokenCount: 1000, candidatesTokenCount: 100, thoughtsTokenCount: 400 },
        },
        {
          text: 'done',
          usage: { promptTokenCount: 1500, candidatesTokenCount: 200, thoughtsTokenCount: 300 },
        },
      ]);
      const events = await run(agent);
      const usage = { input: 2500, output: 300, thinking: 700 };
      const done = events.at(-1);
      expect(done).toMatchObject({ type: 'done', usage });
      const expected = estimateCostUsd('gemini-3.8-flash', usage, new Date('2026-11-09T00:00:00Z'));
      expect(done).toMatchObject({ costUsd: expected });

      const packets = telemetry.entities().filter((p) => p.method === 'generateContent');
      expect(packets).toHaveLength(2);
      expect(packets[0]).toMatchObject({
        channel: 'llm',
        status: 'ok',
        model: 'gemini-3.8-flash',
        tokens: { input: 1000, output: 100, thinking: 400 },
      });
      expect(packets[0]?.costUsd).toBeGreaterThan(0);
      expect(telemetry.byModel()[0]).toMatchObject({ model: 'gemini-3.8-flash', calls: 2 });
      expect(telemetry.byModel()[0]?.tokens).toEqual(usage);
    });

    it('tags the packets with the run id', async () => {
      const { agent, telemetry } = setup([{ text: 'hi' }]);
      await run(agent, 'go', { runId: 'run-7' });
      expect(telemetry.entities().find((p) => p.method === 'generateContent')?.runId).toBe('run-7');
    });
  });

  describe('errors', () => {
    it.each([
      [
        'an invalid key',
        new FakeApiError(400, 'API key not valid. Please pass a valid API key.'),
        'auth',
      ],
      ['a 401', new FakeApiError(401, 'Unauthorized'), 'auth'],
      ['a 403 about the key', new FakeApiError(403, 'API key was reported as leaked'), 'auth'],
      ['a 429', new FakeApiError(429, 'Resource exhausted'), 'quota'],
      ['a 404', new FakeApiError(404, 'models/gemini-4-argon is not found'), 'model-access'],
      [
        'a 403 about the model',
        new FakeApiError(403, 'You do not have access to this model'),
        'model-access',
      ],
      ['a failed fetch', new TypeError('Failed to fetch'), 'network'],
      ['a server error', new FakeApiError(500, 'Internal'), 'unknown'],
    ])('maps %s to %s', async (_, error, kind) => {
      const { agent, telemetry } = setup([{ error }]);
      const events = await run(agent);
      expect(events).toEqual([expect.objectContaining({ type: 'error', kind })]);
      const packet = telemetry.entities().find((p) => p.method === 'generateContent');
      expect(packet?.status).toBe('error');
    });

    it('reports a client that cannot be created', async () => {
      TestBed.configureTestingModule({
        providers: [
          {
            provide: GENAI_CLIENT_FACTORY,
            useValue: () => Promise.reject(new TypeError('Failed to fetch')),
          },
          { provide: AGENT_CONFIG, useValue: { apiKey: signal(KEY), model } },
        ],
      });
      const events = await collect(
        TestBed.inject(GeminiAgent).run('hi', { signal: new AbortController().signal }),
      );
      expect(events).toEqual([expect.objectContaining({ type: 'error', kind: 'network' })]);
    });

    it('unwraps the message of a JSON error body', async () => {
      const body = JSON.stringify({ error: { code: 429, message: 'Quota exceeded for metric' } });
      const { agent } = setup([{ error: new FakeApiError(429, body) }]);
      const events = await run(agent);
      expect(events[0]).toMatchObject({ kind: 'quota', message: 'Quota exceeded for metric' });
    });
  });

  describe('redaction', () => {
    it('never shows the key in an error event or in the packets', async () => {
      const { agent, telemetry } = setup([
        {
          error: new FakeApiError(400, `bad request for https://x/v1/models?key=${KEY} and ${KEY}`),
        },
      ]);
      const events = await run(agent, `my key is ${KEY}`);
      expect(JSON.stringify(events)).not.toContain(KEY);
      expect(telemetry.exportJson()).not.toContain(KEY);
      expect(telemetry.exportJson()).toContain('•••');
    });

    it('keeps the key out of the packets of a successful run', async () => {
      register('echo', () => text({ echoed: KEY }));
      const { agent, telemetry } = setup([
        { functionCalls: [{ name: 'echo', args: { key: KEY } }] },
        { text: `the key is ${KEY}` },
      ]);
      await run(agent, `use ${KEY}`);
      expect(telemetry.exportJson()).not.toContain(KEY);
    });
  });
});

describe('classifyError', () => {
  it('falls back to unknown for non-error values', () => {
    expect(classifyError('boom')).toEqual({ kind: 'unknown', message: 'boom' });
  });

  it('recognises network wording without a status', () => {
    expect(classifyError(new Error('Network request failed')).kind).toBe('network');
  });
});

describe('isAbort', () => {
  it('is true for an aborted signal or an AbortError', () => {
    const live = new AbortController();
    expect(isAbort(new Error('x'), live.signal)).toBe(false);
    expect(isAbort(Object.assign(new Error('x'), { name: 'AbortError' }), live.signal)).toBe(true);
    live.abort();
    expect(isAbort(new Error('x'), live.signal)).toBe(true);
  });
});
