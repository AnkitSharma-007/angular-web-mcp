import {
  installFakeModelContext,
  uninstallFakeModelContext,
  type FakeModelContext,
} from '../../../testing/fake-model-context';
import { findModelContext, type RegistryTool } from './model-context';

function tool(name: string, execute: RegistryTool['execute'] = () => 'ok'): RegistryTool {
  return { name, description: `${name} tool`, execute };
}

describe('fake model context (registry shim)', () => {
  let registry: FakeModelContext;

  beforeEach(() => {
    registry = installFakeModelContext();
  });

  afterEach(() => {
    uninstallFakeModelContext();
  });

  it('returns tools sorted by name', () => {
    registry.registerTool(tool('zeta'));
    registry.registerTool(tool('alpha'));
    registry.registerTool(tool('mid'));
    expect(registry.getTools().map((t) => t.name)).toEqual(['alpha', 'mid', 'zeta']);
  });

  it('exposes optional metadata only when provided', () => {
    registry.registerTool({
      ...tool('a'),
      title: 'A',
      inputSchema: { type: 'object' },
      annotations: { readOnlyHint: true },
    });
    registry.registerTool(tool('b'));
    const [a, b] = registry.getTools();
    expect(a).toEqual({
      name: 'a',
      description: 'a tool',
      title: 'A',
      inputSchema: { type: 'object' },
      annotations: { readOnlyHint: true },
    });
    expect(b).toEqual({ name: 'b', description: 'b tool' });
  });

  it('throws on a duplicate name', () => {
    registry.registerTool(tool('dup'));
    expect(() => registry.registerTool(tool('dup'))).toThrow('Tool already registered: dup');
  });

  it('unregisters on abort and fires toolchange for each change', () => {
    const listener = vi.fn();
    registry.addEventListener('toolchange', listener);
    const controller = new AbortController();
    registry.registerTool(tool('temp'), { signal: controller.signal });
    expect(listener).toHaveBeenCalledTimes(1);
    controller.abort();
    expect(registry.toolNames()).toEqual([]);
    expect(listener).toHaveBeenCalledTimes(2);
  });

  it('allows re-registering a name after its abort', () => {
    const controller = new AbortController();
    registry.registerTool(tool('again'), { signal: controller.signal });
    controller.abort();
    expect(() => registry.registerTool(tool('again'))).not.toThrow();
  });

  it('ignores registration with an already aborted signal', () => {
    registry.registerTool(tool('dead'), { signal: AbortSignal.abort() });
    expect(registry.toolNames()).toEqual([]);
  });

  it('does not unregister a newer tool of the same name on a stale abort', () => {
    const first = new AbortController();
    registry.registerTool(tool('x'), { signal: first.signal });
    registry.reset();
    registry.registerTool(tool('x'));
    first.abort();
    expect(registry.toolNames()).toEqual(['x']);
  });

  it('executes a tool with args and forwards the abort signal', async () => {
    const execute = vi.fn((args: { n: number }) => args.n * 2);
    registry.registerTool(tool('double', execute as RegistryTool['execute']));
    const controller = new AbortController();
    await expect(
      registry.executeTool('double', { n: 4 }, { signal: controller.signal }),
    ).resolves.toBe(8);
    expect(execute).toHaveBeenCalledWith({ n: 4 }, { signal: controller.signal });
  });

  it('executes without a signal and rejects unknown tools', async () => {
    const execute = vi.fn(() => 'done');
    registry.registerTool(tool('plain', execute));
    await registry.executeTool('plain', {});
    expect(execute).toHaveBeenCalledWith({}, {});
    await expect(registry.executeTool('missing', {})).rejects.toThrow('Unknown tool: missing');
  });

  it('is discoverable through findModelContext', () => {
    expect(findModelContext()).toBe(registry);
    uninstallFakeModelContext();
    expect(findModelContext()).toBeNull();
  });
});
