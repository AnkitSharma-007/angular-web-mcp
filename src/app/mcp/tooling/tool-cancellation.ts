import { Service } from '@angular/core';

type CancelHandler = () => void;

/** Lets in-app callers tell a tool that runs outside `defineTool` (such as the generated form tool) that its call was aborted. */
@Service()
export class ToolCancellation {
  private readonly handlers = new Map<string, Set<CancelHandler>>();

  onCancel(toolName: string, handler: CancelHandler): () => void {
    const set = this.handlers.get(toolName) ?? new Set<CancelHandler>();
    set.add(handler);
    this.handlers.set(toolName, set);
    return () => {
      set.delete(handler);
      if (set.size === 0 && this.handlers.get(toolName) === set) {
        this.handlers.delete(toolName);
      }
    };
  }

  notify(toolName: string): void {
    for (const handler of [...(this.handlers.get(toolName) ?? [])]) {
      handler();
    }
  }
}
