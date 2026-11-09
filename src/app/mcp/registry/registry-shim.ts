import type { ModelContextRegistry, RegistryTool, RegistryToolInfo } from './model-context';

export class RegistryShim extends EventTarget implements ModelContextRegistry {
  protected readonly tools = new Map<string, RegistryTool>();

  registerTool(tool: RegistryTool, options: { signal?: AbortSignal } = {}): void {
    if (this.tools.has(tool.name)) {
      throw new Error(`Tool already registered: ${tool.name}`);
    }
    const { signal } = options;
    if (signal?.aborted) return;
    this.tools.set(tool.name, tool);
    this.dispatchEvent(new Event('toolchange'));
    signal?.addEventListener('abort', () => this.unregister(tool), { once: true });
  }

  getTools(): readonly RegistryToolInfo[] {
    return [...this.tools.values()]
      .map(({ name, title, description, inputSchema, annotations }) => ({
        name,
        description,
        ...(title !== undefined && { title }),
        ...(inputSchema !== undefined && { inputSchema }),
        ...(annotations !== undefined && { annotations }),
      }))
      .sort((a, b) => a.name.localeCompare(b.name));
  }

  async executeTool(
    name: string,
    args: Record<string, unknown>,
    options: { signal?: AbortSignal } = {},
  ): Promise<unknown> {
    const tool = this.tools.get(name);
    if (!tool) throw new Error(`Unknown tool: ${name}`);
    return tool.execute(args as never, options.signal ? { signal: options.signal } : {});
  }

  private unregister(tool: RegistryTool): void {
    if (this.tools.get(tool.name) === tool) {
      this.tools.delete(tool.name);
      this.dispatchEvent(new Event('toolchange'));
    }
  }
}
