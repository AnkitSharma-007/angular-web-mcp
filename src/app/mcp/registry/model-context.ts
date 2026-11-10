import type { JsonSchema } from '../schema/validate-args';

export interface RegistryToolClient {
  signal?: AbortSignal;
}

export interface RegistryTool {
  name: string;
  title?: string;
  description: string;
  inputSchema?: JsonSchema;
  annotations?: Record<string, unknown>;
  execute(args: never, client: RegistryToolClient): unknown;
}

export interface RegistryToolInfo {
  name: string;
  title?: string;
  description: string;
  inputSchema?: object;
  annotations?: object;
}

/** Mirrors the WebMCP `RegisteredTool`: the opaque handle `executeTool` needs, with origin and window identity. */
export interface RegisteredTool extends RegistryToolInfo {
  origin: string;
  window: Window;
}

export interface ModelContextRegistry extends EventTarget {
  registerTool(tool: RegistryTool, options?: { signal?: AbortSignal }): Promise<void>;
  getTools(): Promise<readonly RegisteredTool[]>;
  executeTool(
    tool: RegisteredTool,
    input?: object,
    options?: { signal?: AbortSignal },
  ): Promise<string>;
}

export function findModelContext(doc: Document = document): ModelContextRegistry | null {
  return (
    read(() => (doc as unknown as ContextHolder).modelContext) ??
    read(() => navigatorOf(doc)?.modelContext) ??
    null
  );
}

interface ContextHolder {
  modelContext?: ModelContextRegistry;
}

function navigatorOf(doc: Document): ContextHolder | undefined {
  return doc.defaultView?.navigator as unknown as ContextHolder | undefined;
}

function read<T>(getter: () => T): T | undefined {
  try {
    return getter();
  } catch {
    return undefined;
  }
}
