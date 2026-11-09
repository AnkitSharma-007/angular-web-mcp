import { Service, inject, signal } from '@angular/core';
import { CLOCK } from '../../core/util/clock';
import {
  findModelContext,
  type ModelContextRegistry,
  type RegisteredTool,
  type RegistryToolInfo,
} from '../registry/model-context';
import { WireTelemetryStore } from '../telemetry/wire-telemetry-store';
import { DiscoveryTracker } from '../registry/discovery-tracker';
import { isSelfInstrumented } from '../tooling/define-tool';
import { ToolCancellation } from '../tooling/tool-cancellation';

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

function parseJson(text: string): { parsed: true; value: unknown } | { parsed: false } {
  try {
    return { parsed: true, value: JSON.parse(text) };
  } catch {
    return { parsed: false };
  }
}

/** Registries return a serialized JSON string; the MCP text envelope inside it may itself hold JSON or plain text. */
export function readResult(serialized: string): { ok: boolean; value: unknown } {
  const outer = parseJson(serialized);
  const raw = outer.parsed ? outer.value : serialized;
  if (typeof raw === 'string') {
    return { ok: !raw.startsWith(FORM_FAILURE_PREFIX), value: raw };
  }
  const { content, isError } = (raw ?? {}) as RawToolResult;
  if (!Array.isArray(content)) {
    return { ok: isError !== true, value: raw ?? null };
  }
  const text = content.map((part) => part.text ?? '').join('\n');
  const inner = parseJson(text);
  return {
    ok: isError !== true && !text.startsWith(FORM_FAILURE_PREFIX),
    value: inner.parsed ? inner.value : text,
  };
}

export type ToolDiscovery = 'loading' | 'ready' | 'error';

/** Client-side view of the WebMCP registry: lists, calls and watches tools, and traces the traffic. */
@Service()
export class McpToolGateway {
  private readonly telemetry = inject(WireTelemetryStore);
  private readonly clock = inject(CLOCK);
  private readonly cancellation = inject(ToolCancellation);
  private readonly tracker = inject(DiscoveryTracker);

  private readonly versionState = signal(0);
  private readonly toolsState = signal<readonly RegistryToolInfo[]>([]);
  private readonly changeState = signal<ToolsChange | null>(null);
  private readonly discoveryState = signal<ToolDiscovery>('loading');

  private registry: ModelContextRegistry | null = null;
  private descriptors = new Map<string, RegisteredTool>();
  private known: string[] = [];
  private generation = 0;
  private applied = 0;
  private initialized = false;
  private flushScheduled = false;

  readonly toolsVersion = this.versionState.asReadonly();
  readonly tools = this.toolsState.asReadonly();
  readonly lastChange = this.changeState.asReadonly();
  readonly discovery = this.discoveryState.asReadonly();

  constructor() {
    this.connect();
  }

  async listTools(): Promise<readonly RegistryToolInfo[]> {
    const registry = this.connect();
    const tools = registry ? await this.load(registry) : [];
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
    let descriptor = this.descriptors.get(name);
    if (registry && !descriptor) {
      await this.load(registry).catch(() => undefined);
      descriptor = this.descriptors.get(name);
    }
    const span =
      descriptor && isSelfInstrumented(name)
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
    if (!descriptor) {
      return settle(false, { error: `Unknown tool: ${name}` });
    }
    const announceCancel = () => this.cancellation.notify(name);
    signal?.addEventListener('abort', announceCancel, { once: true });
    try {
      const serialized = await registry.executeTool(descriptor, args, signal ? { signal } : {});
      const { ok, value } = readResult(serialized);
      return settle(ok, value);
    } catch (error) {
      return settle(false, { error: error instanceof Error ? error.message : String(error) });
    } finally {
      signal?.removeEventListener('abort', announceCancel);
    }
  }

  waitForTool(name: string, timeoutMs: number, signal?: AbortSignal): Promise<boolean> {
    const registry = this.connect();
    if (!registry) {
      return Promise.resolve(false);
    }
    const present = async () => (await registry.getTools()).some((tool) => tool.name === name);
    return new Promise((resolve) => {
      let done = false;
      const finish = (found: boolean) => {
        if (done) {
          return;
        }
        done = true;
        clearTimeout(timer);
        registry.removeEventListener('toolchange', check);
        signal?.removeEventListener('abort', onAbort);
        resolve(found);
      };
      const check = () => {
        present().then(
          (found) => found && finish(true),
          () => undefined,
        );
      };
      const onAbort = () => finish(false);
      const timer = setTimeout(() => finish(false), timeoutMs);
      registry.addEventListener('toolchange', check);
      if (signal?.aborted) {
        onAbort();
      } else {
        signal?.addEventListener('abort', onAbort, { once: true });
        check();
      }
    });
  }

  private connect(): ModelContextRegistry | null {
    const registry = findModelContext();
    if (registry !== this.registry) {
      this.registry?.removeEventListener('toolchange', this.onToolChange);
      this.registry = registry;
      this.applied = ++this.generation;
      this.descriptors = new Map();
      this.toolsState.set([]);
      this.known = [];
      this.initialized = false;
      registry?.addEventListener('toolchange', this.onToolChange);
      if (registry) {
        this.discoveryState.set('loading');
        void this.discover(registry);
      } else {
        this.discoveryState.set('ready');
      }
    }
    return registry;
  }

  /** Reads the registry; a result is applied only if it is newer than the last applied one, so a slow older read cannot resurrect removed tools. */
  private async load(registry: ModelContextRegistry): Promise<readonly RegistryToolInfo[]> {
    const generation = ++this.generation;
    const registered = await registry.getTools();
    if (registry === this.registry && generation > this.applied) {
      this.applied = generation;
      this.descriptors = new Map(registered.map((tool) => [tool.name, tool]));
      this.toolsState.set(registered.map(toInfo));
      this.discoveryState.set('ready');
      this.announceChange(registered.map((tool) => tool.name));
    }
    return registered.map(toInfo);
  }

  private discover(registry: ModelContextRegistry): Promise<void> {
    const run = this.load(registry).then(
      () => undefined,
      () => {
        if (registry === this.registry) {
          this.discoveryState.set('error');
        }
      },
    );
    this.tracker.track(run);
    return run;
  }

  private readonly onToolChange = (): void => {
    if (this.flushScheduled) {
      return;
    }
    this.flushScheduled = true;
    queueMicrotask(() => {
      this.flushScheduled = false;
      if (this.registry) {
        void this.discover(this.registry);
      }
    });
  };

  private announceChange(names: string[]): void {
    const { added, removed } = diffTools(this.known, names);
    this.known = names;
    if (!this.initialized) {
      this.initialized = true;
      return;
    }
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

function toInfo({
  name,
  title,
  description,
  inputSchema,
  annotations,
}: RegisteredTool): RegistryToolInfo {
  return {
    name,
    description,
    ...(title !== undefined && { title }),
    ...(inputSchema !== undefined && { inputSchema }),
    ...(annotations !== undefined && { annotations }),
  };
}

function errorText(result: unknown): string {
  if (typeof result === 'string') {
    return result;
  }
  const message = (result as { error?: unknown } | null)?.error;
  return typeof message === 'string' ? message : JSON.stringify(result);
}
