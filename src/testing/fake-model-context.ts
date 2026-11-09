import type { RegistryTool } from '../app/mcp/registry/model-context';
import { RegistryShim } from '../app/mcp/registry/registry-shim';

export type FakeToolInfo = Pick<
  RegistryTool,
  'name' | 'description' | 'inputSchema' | 'annotations'
> & {
  title: string;
};

export class FakeModelContext extends RegistryShim {
  toolNames(): string[] {
    return this.describe().map((tool) => tool.name);
  }

  toolInfos(): FakeToolInfo[] {
    return this.describe().map((tool) => ({
      name: tool.name,
      title: tool.title ?? tool.name,
      description: tool.description,
      ...(tool.inputSchema !== undefined && { inputSchema: tool.inputSchema }),
      ...(tool.annotations !== undefined && { annotations: tool.annotations }),
    })) as FakeToolInfo[];
  }

  /** Runs a tool through the contract path (descriptor in, serialized string out) and returns the decoded envelope. */
  async call(
    name: string,
    args: object = {},
    options: { signal?: AbortSignal } = {},
  ): Promise<unknown> {
    const tool = this.describe().find((candidate) => candidate.name === name);
    if (!tool) {
      throw new Error(`Unknown tool: ${name}`);
    }
    return JSON.parse(await this.executeTool(tool, args, options)) as unknown;
  }

  /** Like call(), but turns an `isError` envelope into a thrown Error carrying the message the model would read. */
  async callOrThrow(
    name: string,
    args: object = {},
    options: { signal?: AbortSignal } = {},
  ): Promise<unknown> {
    const result = await this.call(name, args, options);
    const envelope = result as { isError?: boolean; content?: { text?: string }[] } | null;
    if (envelope?.isError) {
      throw new Error(envelope.content?.map((part) => part.text ?? '').join('\n'));
    }
    return result;
  }

  reset(): void {
    this.tools.clear();
  }
}

interface ContextHolder {
  modelContext?: unknown;
}

export function installFakeModelContext(doc: Document = document): FakeModelContext {
  const fake = new FakeModelContext(doc);
  Object.defineProperty(doc, 'modelContext', { value: fake, configurable: true, writable: true });
  return fake;
}

export function uninstallFakeModelContext(doc: Document = document): void {
  delete (doc as ContextHolder).modelContext;
}
