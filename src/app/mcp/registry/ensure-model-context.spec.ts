import { findModelContext } from './model-context';
import { RegistryShim } from './registry-shim';

const installWebMCP = vi.hoisted(() => vi.fn());
vi.mock('@mcp-b/webmcp-polyfill', () => ({ installWebMCP }));

import { ensureModelContext } from './ensure-model-context';

function clear(): void {
  delete (document as { modelContext?: unknown }).modelContext;
}

describe('ensureModelContext', () => {
  beforeEach(() => {
    clear();
    installWebMCP.mockReset();
  });

  afterEach(clear);

  it('reports native when document.modelContext already exists', async () => {
    const existing = new RegistryShim();
    Object.defineProperty(document, 'modelContext', { value: existing, configurable: true });
    await expect(ensureModelContext()).resolves.toBe('native');
    expect(installWebMCP).not.toHaveBeenCalled();
    expect(findModelContext()).toBe(existing);
  });

  it('installs the polyfill when no native registry exists', async () => {
    installWebMCP.mockImplementation(() => {
      Object.defineProperty(document, 'modelContext', {
        value: new RegistryShim(),
        configurable: true,
      });
    });
    await expect(ensureModelContext()).resolves.toBe('polyfill');
    expect(installWebMCP).toHaveBeenCalledOnce();
  });

  it('falls back to the shim when the polyfill installs nothing', async () => {
    await expect(ensureModelContext()).resolves.toBe('shim');
    expect(findModelContext()).toBeInstanceOf(RegistryShim);
  });

  it('falls back to the shim when the polyfill throws', async () => {
    installWebMCP.mockImplementation(() => {
      throw new TypeError('Cannot install WebMCP on this realm');
    });
    await expect(ensureModelContext()).resolves.toBe('shim');
    expect(findModelContext()).toBeInstanceOf(RegistryShim);
  });

  it('treats a throwing modelContext getter as absent', async () => {
    Object.defineProperty(document, 'modelContext', {
      get() {
        throw new Error('broken getter');
      },
      configurable: true,
    });
    expect(findModelContext()).toBeNull();
    await expect(ensureModelContext()).resolves.toBe('shim');
  });

  it('finds a registry on navigator as a fallback location', () => {
    const nav = new RegistryShim();
    Object.defineProperty(navigator, 'modelContext', { value: nav, configurable: true });
    expect(findModelContext()).toBe(nav);
    delete (navigator as { modelContext?: unknown }).modelContext;
  });
});
