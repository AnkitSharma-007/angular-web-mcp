import {
  EnvironmentInjector,
  ErrorHandler,
  createEnvironmentInjector,
  type WebMcpToolDescriptor,
} from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { patchState, signalStore, withFeature, withMethods, withState } from '@ngrx/signals';
import { useFakeModelContext } from '../../../testing/test-providers';
import { withWebMcpTools } from './with-webmcp-tools';

const Counter = signalStore(
  withState({ count: 1 }),
  withMethods((store) => ({
    increment: () => patchState(store, { count: store.count() + 1 }),
  })),
  withFeature((store) =>
    withWebMcpTools(() => [
      probe('readCount', () => store.count()),
      probe('bump', () => {
        store.increment();
        return store.count();
      }),
    ]),
  ),
);

function probe(name: string, read: () => number): WebMcpToolDescriptor {
  return {
    name,
    description: `Probe tool ${name}`,
    inputSchema: { type: 'object', properties: {} },
    execute: async () => ({ content: [{ type: 'text', text: String(read()) }] }),
  };
}

describe('withWebMcpTools', () => {
  const registry = useFakeModelContext();
  const handleError = vi.fn();

  beforeEach(() => {
    handleError.mockClear();
    TestBed.configureTestingModule({
      providers: [Counter, { provide: ErrorHandler, useValue: { handleError } }],
    });
  });

  function child() {
    return createEnvironmentInjector([Counter], TestBed.inject(EnvironmentInjector));
  }

  async function text(name: string): Promise<string> {
    const result = (await registry.current.executeTool(name, {})) as {
      content: { text: string }[];
    };
    return result.content[0]?.text ?? '';
  }

  it('registers the tools when the store is created, not before', () => {
    expect(registry.current.toolNames()).toEqual([]);
    TestBed.inject(Counter);
    expect(registry.current.toolNames()).toEqual(['bump', 'readCount']);
  });

  it('unregisters the tools when the store injector is destroyed', () => {
    const injector = child();
    injector.get(Counter);
    expect(registry.current.toolNames()).toEqual(['bump', 'readCount']);

    const listener = vi.fn();
    registry.current.addEventListener('toolchange', listener);
    injector.destroy();
    expect(registry.current.toolNames()).toEqual([]);
    expect(listener).toHaveBeenCalledTimes(2);
  });

  it('hands the tools the typed store, so execute needs no inject()', async () => {
    const store = TestBed.inject(Counter);
    expect(await text('readCount')).toBe('1');
    expect(await text('bump')).toBe('2');
    expect(store.count()).toBe(2);
  });

  it('reports a duplicate registration from a second store instance and keeps the first', async () => {
    const first = child();
    const second = child();
    first.get(Counter);
    second.get(Counter);
    await vi.waitFor(() => expect(handleError).toHaveBeenCalledTimes(2));
    expect(handleError.mock.calls[0]?.[0]).toEqual(
      expect.objectContaining({ message: expect.stringContaining('Tool already registered') }),
    );

    second.destroy();
    expect(registry.current.toolNames()).toEqual(['bump', 'readCount']);
    first.destroy();
    expect(registry.current.toolNames()).toEqual([]);
  });

  it('does nothing when no registry exists', () => {
    delete (document as { modelContext?: unknown }).modelContext;
    TestBed.inject(Counter);
    expect(handleError).not.toHaveBeenCalled();
  });
});
