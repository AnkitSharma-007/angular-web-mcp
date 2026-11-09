import { RegistryShim } from '../app/mcp/registry/registry-shim';

export class FakeModelContext extends RegistryShim {
  toolNames(): string[] {
    return this.getTools().map((tool) => tool.name);
  }

  reset(): void {
    this.tools.clear();
  }
}

interface ContextHolder {
  modelContext?: unknown;
}

export function installFakeModelContext(doc: Document = document): FakeModelContext {
  const fake = new FakeModelContext();
  Object.defineProperty(doc, 'modelContext', { value: fake, configurable: true, writable: true });
  return fake;
}

export function uninstallFakeModelContext(doc: Document = document): void {
  delete (doc as ContextHolder).modelContext;
}
