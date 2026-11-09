import { Service, inject, signal } from '@angular/core';
import { CLOCK } from '../../core/util/clock';
import {
  findModelContext,
  type ModelContextRegistry,
  type RegistryToolInfo,
} from '../registry/model-context';
import { WireTelemetryStore } from '../telemetry/wire-telemetry-store';
import { isSelfInstrumented } from '../tooling/define-tool';

export const FORM_FAILURE_PREFIX = 'Form submission failed';

export interface ToolsDiff {
  added: string[];
  removed: string[];
}

export interface ToolsChange extends ToolsDiff {
  version: number;
}

export interface ToolCallResult {
  name: string;
  ok: boolean;
  result: unknown;
  latencyMs: number;
}

export function diffTools(before: readonly string[], after: readonly string[]): ToolsDiff {
  const previous = new Set(before);
  const next = new Set(after);
  return {
    added: after.filter((name) => !previous.has(name)),
    removed: before.filter((name) => !next.has(name)),
  };
}

interface RawToolResult {
  content?: { type?: string; text?: string }[];
  isError?: boolean;
}

function readResult(raw: unknown): { ok: boolean; value: unknown } {
  const { content, isError } = (raw ?? {}) as RawToolResult;
  if (!Array.isArray(content)) {
    return { ok: isError !== true, value: raw ?? null };
  }
  const text = content.map((part) => part.text ?? '').join('\n');
  let value: unknown = text;
  try {
    value = JSON.parse(text);
  } catch {
    // Form tools answer in plain text, which is passed on as is.
  }
  return { ok: isError !== true && !text.startsWith(FORM_FAILURE_PREFIX), value };
}

/** Client-side view of the WebMCP registry: lists, calls and watches tools, and traces the traffic. */
@Service()
export class McpToolGateway {
  private readonly telemetry = inject(WireTelemetryStore);
  private readonly clock = inject(CLOCK);

  private readonly versionState = signal(0);
  private readonly toolsState = signal<readonly RegistryToolInfo[]>([]);
  private readonly changeState = signal<ToolsChange | null>(null);

  private registry: ModelContextRegistry | null = null;
  private known: string[] = [];
  private flushScheduled = false;

  readonly toolsVersion = this.versionState.asReadonly();
  readonly tools = this.toolsState.asReadonly();
  readonly lastChange = this.changeState.asReadonly();

  constructor() {
    this.connect();
  }

  listTools(): readonly RegistryToolInfo[] {
    const registry = this.connect();
    const tools = registry?.getTools() ?? [];
    this.telemetry.record(
      { channel: 'mcp', method: 'tools/list' },
      { status: 'ok', result: { tools: tools.map((tool) => tool.name) } },
    );
    return tools;
  }

  async callTool(
    name: string,
    args: Record<string, unknown>,
    signal?: AbortSignal,
  ): Promise<ToolCallResult> {
    const registry = this.connect();
    const startedAt = this.clock().getTime();
    const span = isSelfInstrumented(name)
      ? null
      : this.telemetry.begin({
          channel: 'mcp',
          method: 'tools/call',
          params: { name, arguments: args },
        });
    const settle = (ok: boolean, result: unknown): ToolCallResult => {
      const latencyMs = this.clock().getTime() - startedAt;
      if (span !== null) {
        this.telemetry.end(span, {
          status: ok ? 'ok' : 'error',
          latencyMs,
          ...(ok ? { result } : { error: errorText(result) }),
        });
      }
      return { name, ok, result, latencyMs };
    };

    if (!registry) {
      return settle(false, { error: 'No WebMCP registry is available in this browser' });
    }
    try {
      const raw = await registry.executeTool(name, args, signal ? { signal } : {});
      const { ok, value } = readResult(raw);
      return settle(ok, value);
    } catch (error) {
      return settle(false, { error: error instanceof Error ? error.message : String(error) });
    }
  }

  waitForTool(name: string, timeoutMs: number, signal?: AbortSignal): Promise<boolean> {
    const registry = this.connect();
    if (!registry) {
      return Promise.resolve(false);
    }
    const present = () => registry.getTools().some((tool) => tool.name === name);
    if (present()) {
      return Promise.resolve(true);
    }
    return new Promise((resolve) => {
      const finish = (found: boolean) => {
        clearTimeout(timer);
        registry.removeEventListener('toolchange', check);
        signal?.removeEventListener('abort', onAbort);
        resolve(found);
      };
      const check = () => {
        if (present()) {
          finish(true);
        }
      };
      const onAbort = () => finish(false);
      const timer = setTimeout(() => finish(false), timeoutMs);
      registry.addEventListener('toolchange', check);
      if (signal?.aborted) {
        onAbort();
      } else {
        signal?.addEventListener('abort', onAbort, { once: true });
      }
    });
  }

  private connect(): ModelContextRegistry | null {
    const registry = findModelContext();
    if (registry !== this.registry) {
      this.registry?.removeEventListener('toolchange', this.onToolChange);
      this.registry = registry;
      registry?.addEventListener('toolchange', this.onToolChange);
      this.toolsState.set(registry?.getTools() ?? []);
      this.known = this.toolsState().map((tool) => tool.name);
    }
    return registry;
  }

  private readonly onToolChange = (): void => {
    if (this.flushScheduled) {
      return;
    }
    this.flushScheduled = true;
    queueMicrotask(() => {
      this.flushScheduled = false;
      this.flush();
    });
  };

  private flush(): void {
    const tools = this.registry?.getTools() ?? [];
    const names = tools.map((tool) => tool.name);
    const { added, removed } = diffTools(this.known, names);
    this.known = names;
    this.toolsState.set(tools);
    if (added.length === 0 && removed.length === 0) {
      return;
    }
    const version = this.versionState() + 1;
    this.versionState.set(version);
    this.changeState.set({ added, removed, version });
    this.telemetry.record(
      {
        channel: 'mcp',
        method: 'notifications/tools/list_changed',
        params: { added, removed },
      },
      { status: 'ok' },
    );
  }
}

function errorText(result: unknown): string {
  if (typeof result === 'string') {
    return result;
  }
  const message = (result as { error?: unknown } | null)?.error;
  return typeof message === 'string' ? message : JSON.stringify(result);
}
