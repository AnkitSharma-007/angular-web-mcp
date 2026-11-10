import {
  installFakeModelContext,
  uninstallFakeModelContext,
  type FakeModelContext,
} from './fake-model-context';
import { findModelContext, type RegistryTool } from '../app/mcp/registry/model-context';

function tool(name: string, execute: RegistryTool['execute'] = () => 'ok'): RegistryTool {
  return { name, description: `${name} tool`, execute };
}

async function descriptor(registry: FakeModelContext, name: string) {
  const found = (await registry.getTools()).find((candidate) => candidate.name === name);
  if (!found) {
    throw new Error(`no descriptor for ${name}`);
  }
  return found;
}

describe('fake model context (registry shim)', () => {
  let registry: FakeModelContext;

  beforeEach(() => {
    registry = installFakeModelContext();
  });

  afterEach(() => {
    uninstallFakeModelContext();
  });

  it('discovers tools asynchronously, sorted by name', async () => {
    await registry.registerTool(tool('zeta'));
    await registry.registerTool(tool('alpha'));
    await registry.registerTool(tool('mid'));
    const pending = registry.getTools();
    expect(pending).toBeInstanceOf(Promise);
    expect((await pending).map((t) => t.name)).toEqual(['alpha', 'mid', 'zeta']);
  });

  it('describes each tool with origin and window identity', async () => {
    await registry.registerTool({
      ...tool('a'),
      title: 'A',
      inputSchema: { type: 'object' },
      annotations: { readOnlyHint: true },
    });
    await registry.registerTool(tool('b'));
    const [a, b] = await registry.getTools();
    expect(a).toMatchObject({
      name: 'a',
      title: 'A',
      description: 'a tool',
      inputSchema: { type: 'object' },
      annotations: { readOnlyHint: true },
      origin: window.location.origin,
      window,
    });
    expect(b).toMatchObject({ name: 'b', title: 'b' });
    expect(b).not.toHaveProperty('inputSchema');
  });

  it('rejects a duplicate registration', async () => {
    await registry.registerTool(tool('dup'));
    await expect(registry.registerTool(tool('dup'))).rejects.toThrow(
      'Tool already registered: dup',
    );
  });

  it('unregisters on abort and fires toolchange for each change', () => {
    const listener = vi.fn();
    registry.addEventListener('toolchange', listener);
    const controller = new AbortController();
    void registry.registerTool(tool('temp'), { signal: controller.signal });
    expect(listener).toHaveBeenCalledTimes(1);
    controller.abort();
    expect(registry.toolNames()).toEqual([]);
    expect(listener).toHaveBeenCalledTimes(2);
  });

  it('allows re-registering a name after its abort', async () => {
    const controller = new AbortController();
    void registry.registerTool(tool('again'), { signal: controller.signal });
    controller.abort();
    await expect(registry.registerTool(tool('again'))).resolves.toBeUndefined();
  });

  it('ignores registration with an already aborted signal', async () => {
    await registry.registerTool(tool('dead'), { signal: AbortSignal.abort() });
    expect(registry.toolNames()).toEqual([]);
  });

  it('does not unregister a newer tool of the same name on a stale abort', async () => {
    const first = new AbortController();
    await registry.registerTool(tool('x'), { signal: first.signal });
    registry.reset();
    await registry.registerTool(tool('x'));
    first.abort();
    expect(registry.toolNames()).toEqual(['x']);
  });

  describe('executeTool', () => {
    it('takes a descriptor and resolves a serialized JSON string', async () => {
      const execute = vi.fn((args: { n: number }) => ({ doubled: args.n * 2 }));
      await registry.registerTool(tool('double', execute as RegistryTool['execute']));
      const result = await registry.executeTool(await descriptor(registry, 'double'), { n: 4 });
      expect(result).toBe('{"doubled":8}');
    });

    it('hands the tool a JSON copy of the input, not the caller object', async () => {
      let seen: { n: number } | undefined;
      await registry.registerTool(
        tool('keep', ((args: { n: number }) => {
          seen = args;
          return null;
        }) as RegistryTool['execute']),
      );
      const input = { n: 1 };
      await registry.executeTool(await descriptor(registry, 'keep'), input);
      expect(seen).toEqual({ n: 1 });
      expect(seen).not.toBe(input);
    });

    it('runs the tool with its own signal that follows the caller abort', async () => {
      let toolSignal: AbortSignal | undefined;
      await registry.registerTool(
        tool('slow', ((_: unknown, client: { signal: AbortSignal }) => {
          toolSignal = client.signal;
          return new Promise(() => undefined);
        }) as RegistryTool['execute']),
      );
      const controller = new AbortController();
      const running = registry.executeTool(
        await descriptor(registry, 'slow'),
        {},
        { signal: controller.signal },
      );
      await vi.waitFor(() => expect(toolSignal).toBeDefined());
      controller.abort(new Error('stop'));
      await expect(running).rejects.toThrow('stop');
      expect(toolSignal?.aborted).toBe(true);
    });

    it('rejects a pre-aborted call without running the tool', async () => {
      const execute = vi.fn(() => 'x');
      await registry.registerTool(tool('never', execute));
      await expect(
        registry.executeTool(
          await descriptor(registry, 'never'),
          {},
          { signal: AbortSignal.abort() },
        ),
      ).rejects.toBeDefined();
      expect(execute).not.toHaveBeenCalled();
    });

    it('hides a thrown tool error behind a generic failure, as real registries do', async () => {
      await registry.registerTool(
        tool('boom', () => {
          throw new Error('secret detail');
        }),
      );
      const failure = (await registry.executeTool(await descriptor(registry, 'boom'), {}).then(
        () => null,
        (error: unknown) => error,
      )) as DOMException;
      expect(failure.name).toBe('UnknownError');
      expect(failure.message).toBe('Tool execution failed');
    });

    it('rejects a value that is not JSON-serializable', async () => {
      await registry.registerTool(tool('void', () => undefined));
      await expect(registry.executeTool(await descriptor(registry, 'void'), {})).rejects.toThrow(
        TypeError,
      );
    });

    it('rejects a stale descriptor whose tool was removed', async () => {
      const controller = new AbortController();
      await registry.registerTool(tool('gone'), { signal: controller.signal });
      const stale = await descriptor(registry, 'gone');
      controller.abort();
      await expect(registry.executeTool(stale, {})).rejects.toThrow('Unknown tool: gone');
    });

    it('rejects a descriptor from another window', async () => {
      await registry.registerTool(tool('here'));
      const foreign = { ...(await descriptor(registry, 'here')), window: {} as Window };
      await expect(registry.executeTool(foreign, {})).rejects.toThrow('Unknown tool: here');
    });
  });

  it('call() decodes the serialized result for specs', async () => {
    await registry.registerTool(tool('echo', () => ({ ok: true })));
    await expect(registry.call('echo')).resolves.toEqual({ ok: true });
    await expect(registry.call('missing')).rejects.toThrow('Unknown tool: missing');
  });

  it('is discoverable through findModelContext', () => {
    expect(findModelContext()).toBe(registry);
    uninstallFakeModelContext();
    expect(findModelContext()).toBeNull();
  });
});
