import type {
  ModelContextRegistry,
  RegisteredTool,
  RegistryTool,
} from '../app/mcp/registry/model-context';

export type FakeToolInfo = Pick<
  RegistryTool,
  'name' | 'description' | 'inputSchema' | 'annotations'
> & {
  title: string;
};

/** In-page stand-in for the native registry that follows the WebMCP client contract: async discovery, descriptor-based calls, serialized results. */
export class FakeModelContext extends EventTarget implements ModelContextRegistry {
  protected readonly tools = new Map<string, RegistryTool>();

  constructor(private readonly doc: Document = document) {
    super();
  }

  registerTool(tool: RegistryTool, options: { signal?: AbortSignal } = {}): Promise<void> {
    if (this.tools.has(tool.name)) {
      return Promise.reject(new Error(`Tool already registered: ${tool.name}`));
    }
    const { signal } = options;
    if (signal?.aborted) return Promise.resolve();
    this.tools.set(tool.name, tool);
    this.dispatchEvent(new Event('toolchange'));
    signal?.addEventListener('abort', () => this.unregister(tool), { once: true });
    return Promise.resolve();
  }

  getTools(): Promise<readonly RegisteredTool[]> {
    return Promise.resolve(this.describe());
  }

  async executeTool(
    tool: RegisteredTool,
    input: object = {},
    options: { signal?: AbortSignal } = {},
  ): Promise<string> {
    const { signal } = options;
    signal?.throwIfAborted();
    const target = this.tools.get(tool.name);
    if (!target || tool.window !== this.window) {
      throw new Error(`Unknown tool: ${tool.name}`);
    }
    const args: unknown = JSON.parse(serialize(input));
    const callback = new AbortController();
    return new Promise<string>((resolve, reject) => {
      const onAbort = () => {
        reject(signal?.reason);
        callback.abort(signal?.reason);
      };
      signal?.addEventListener('abort', onAbort, { once: true });
      const settle = () => signal?.removeEventListener('abort', onAbort);
      Promise.resolve()
        .then(() => target.execute(args as never, { signal: callback.signal }))
        .then(
          (value) => {
            settle();
            try {
              resolve(serialize(value));
            } catch (error) {
              reject(error);
            }
          },
          () => {
            settle();
            // Native and polyfill registries hide the tool's own error message from the caller.
            reject(new DOMException('Tool execution failed', 'UnknownError'));
          },
        );
    });
  }

  protected describe(): RegisteredTool[] {
    const window = this.window;
    return [...this.tools.values()]
      .map(({ name, title, description, inputSchema, annotations }) => ({
        name,
        title: title ?? name,
        description,
        ...(inputSchema !== undefined && { inputSchema }),
        ...(annotations !== undefined && { annotations }),
        origin: window.location.origin,
        window,
      }))
      .sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
  }

  private get window(): Window {
    return this.doc.defaultView ?? window;
  }

  private unregister(tool: RegistryTool): void {
    if (this.tools.get(tool.name) === tool) {
      this.tools.delete(tool.name);
      this.dispatchEvent(new Event('toolchange'));
    }
  }

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

function serialize(value: unknown): string {
  const json = JSON.stringify(value);
  if (json === undefined) {
    throw new TypeError('Value is not JSON-serializable');
  }
  return json;
}
