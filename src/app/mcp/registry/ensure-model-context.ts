import { findModelContext, type RegistryKind } from './model-context';
import { RegistryShim } from './registry-shim';

/** Guarantees `document.modelContext` exists: native first, then the @mcp-b polyfill, then an in-page shim. */
export async function ensureModelContext(doc: Document = document): Promise<RegistryKind> {
  if (findModelContext(doc)) return 'native';

  try {
    const { installWebMCP } = await import('@mcp-b/webmcp-polyfill');
    installWebMCP();
    if (findModelContext(doc)) return 'polyfill';
  } catch {
    // The polyfill refuses insecure contexts and frozen realms; the shim below covers both.
  }

  Object.defineProperty(doc, 'modelContext', {
    value: new RegistryShim(),
    configurable: true,
    writable: true,
  });
  return 'shim';
}
