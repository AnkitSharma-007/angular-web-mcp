import { Injector, declareExperimentalWebMcpTool } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { McpToolGateway } from '../agent/mcp-tool-gateway';
import { defineTool } from '../tooling/define-tool';
import { ensureModelContext } from './ensure-model-context';
import type { ModelContextRegistry } from './model-context';

const tool = (name: string, run: () => unknown = () => ({ pong: true })) =>
  defineTool<Record<string, never>>({
    name,
    description: `${name} tool`,
    inputSchema: {
      type: 'object',
      properties: { n: { type: 'number' } },
      additionalProperties: false,
    },
    run,
  });

describe('installed @mcp-b polyfill (independent contract check)', () => {
  let originalWindow: PropertyDescriptor | undefined;

  beforeAll(async () => {
    // The polyfill needs a secure context and reads `window` through a browser-style accessor, which jsdom lacks.
    originalWindow = Object.getOwnPropertyDescriptor(globalThis, 'window');
    const windowValue = globalThis.window;
    Object.defineProperty(globalThis, 'window', {
      configurable: true,
      get: () => windowValue,
    });
    vi.stubGlobal('isSecureContext', true);
    expect(await ensureModelContext()).toBe('polyfill');
  });

  afterAll(() => {
    vi.unstubAllGlobals();
    if (originalWindow) {
      Object.defineProperty(globalThis, 'window', originalWindow);
    }
    delete (Document.prototype as unknown as { modelContext?: unknown }).modelContext;
    delete (globalThis as unknown as { ModelContext?: unknown }).ModelContext;
    delete (document as unknown as { modelContext?: unknown }).modelContext;
  });

  async function setup() {
    const gateway = TestBed.inject(McpToolGateway);
    const injector = TestBed.inject(Injector);
    return { gateway, injector };
  }

  it('discovers and calls tools registered through declareExperimentalWebMcpTool', async () => {
    const { gateway, injector } = await setup();
    const controller = new AbortController();
    await declareExperimentalWebMcpTool(tool('ping'), injector);
    await vi.waitFor(() => expect(gateway.tools().map((t) => t.name)).toEqual(['ping']));

    const listed = await gateway.listTools();
    expect(listed[0]).toMatchObject({ name: 'ping', description: 'ping tool' });
    expect(listed[0]).not.toHaveProperty('window');

    const outcome = await gateway.callTool('ping', {}, controller.signal);
    expect(outcome).toMatchObject({ ok: true, result: { pong: true } });
  });

  it('keeps validation messages readable and rejects unknown tools', async () => {
    const { gateway, injector } = await setup();
    await declareExperimentalWebMcpTool(tool('strict'), injector);
    await vi.waitFor(() => expect(gateway.tools()).toHaveLength(1));

    const invalid = await gateway.callTool('strict', { n: 'nope' });
    expect(invalid.ok).toBe(false);
    expect(JSON.stringify(invalid.result)).toContain('Invalid input for strict');

    const unknown = await gateway.callTool('nothing', {});
    expect(unknown).toMatchObject({ ok: false, result: { error: 'Unknown tool: nothing' } });
  });

  it('announces additions and removals from toolchange', async () => {
    const { gateway, injector } = await setup();
    await vi.waitFor(() => expect(gateway.discovery()).toBe('ready'));
    await declareExperimentalWebMcpTool(tool('first'), injector);
    await vi.waitFor(() => expect(gateway.lastChange()?.added).toEqual(['first']));
  });

  it('cancels a pre-aborted call without running the tool', async () => {
    const { gateway, injector } = await setup();
    const run = vi.fn(() => ({ pong: true }));
    await declareExperimentalWebMcpTool(tool('guarded', run), injector);
    await vi.waitFor(() => expect(gateway.tools()).toHaveLength(1));
    const outcome = await gateway.callTool('guarded', {}, AbortSignal.abort());
    expect(outcome.ok).toBe(false);
    expect(run).not.toHaveBeenCalled();
  });
});

describe('local registry interface vs the pinned WebMCP types', () => {
  it('satisfies the client half (getTools, executeTool) of the platform ModelContext', () => {
    const platform = document.modelContext as NonNullable<Document['modelContext']>;
    const client: Pick<ModelContextRegistry, 'getTools' | 'executeTool'> = platform;
    expect(client).toBe(platform);
  });
});
