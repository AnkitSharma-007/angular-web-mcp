import type { JsonSchema } from '../schema/validate-args';

export type RegistryKind = 'native' | 'polyfill' | 'shim';

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
  inputSchema?: JsonSchema;
  annotations?: Record<string, unknown>;
}

export interface ModelContextRegistry extends EventTarget {
  registerTool(tool: RegistryTool, options?: { signal?: AbortSignal }): void;
  getTools(): readonly RegistryToolInfo[];
  executeTool(
    name: string,
    args: Record<string, unknown>,
    options?: { signal?: AbortSignal },
  ): Promise<unknown>;
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
