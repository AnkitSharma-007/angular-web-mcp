import { Injector, declareExperimentalWebMcpTool } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { CLOCK } from '../../core/util/clock';
import { WireTelemetryStore } from '../telemetry/wire-telemetry-store';
import { defineTool } from '../tooling/define-tool';
import { useFakeModelContext } from '../../../testing/test-providers';
import { McpToolGateway, diffTools, FORM_FAILURE_PREFIX } from './mcp-tool-gateway';

const text = (value: string) => ({ content: [{ type: 'text', text: value }] });

describe('diffTools', () => {
  it('lists added and removed names in order', () => {
    expect(diffTools(['a', 'b', 'c'], ['b', 'd', 'e'])).toEqual({
      added: ['d', 'e'],
      removed: ['a', 'c'],
    });
  });

  it('is empty when nothing changed', () => {
    expect(diffTools(['a'], ['a'])).toEqual({ added: [], removed: [] });
  });
});

describe('McpToolGateway', () => {
  const registry = useFakeModelContext();
  let now = 1000;

  function setup() {
    now = 1000;
    TestBed.configureTestingModule({
      providers: [{ provide: CLOCK, useValue: () => new Date((now += 5)) }],
    });
    return {
      gateway: TestBed.inject(McpToolGateway),
      telemetry: TestBed.inject(WireTelemetryStore),
    };
  }

  function register(name: string, execute: (args: never) => unknown = () => text('{"ok":true}')) {
    const controller = new AbortController();
    registry.current.registerTool(
      { name, description: name, execute },
      { signal: controller.signal },
    );
    return controller;
  }

  const flush = () => new Promise<void>((resolve) => setTimeout(resolve));

  describe('listTools', () => {
    it('returns the registry tools and records a tools/list packet', async () => {
      register('alpha');
      register('beta');
      const { gateway, telemetry } = setup();
      expect((await gateway.listTools()).map((t) => t.name)).toEqual(['alpha', 'beta']);
      const [packet] = telemetry.entities();
      expect(packet).toMatchObject({ channel: 'mcp', method: 'tools/list', status: 'ok' });
      expect(packet?.envelope.response?.result).toEqual({ tools: ['alpha', 'beta'] });
    });

    it('returns nothing when no registry exists', async () => {
      const { gateway } = setup();
      (document as unknown as { modelContext?: unknown }).modelContext = undefined;
      await expect(gateway.listTools()).resolves.toEqual([]);
    });
  });

  describe('callTool', () => {
    it('parses a JSON result and records a tools/call packet for a plain tool', async () => {
      register('plain', () => text('{"count":3}'));
      const { gateway, telemetry } = setup();
      const outcome = await gateway.callTool('plain', { q: 1 });
      expect(outcome).toMatchObject({ name: 'plain', ok: true, result: { count: 3 } });
      expect(outcome.latencyMs).toBeGreaterThan(0);

      const [packet] = telemetry.entities();
      expect(packet).toMatchObject({ method: 'tools/call', status: 'ok' });
      expect(packet?.envelope.request.params).toEqual({ name: 'plain', arguments: { q: 1 } });
    });

    it('does not double count a tool that records its own span', async () => {
      const tool = defineTool<Record<string, never>>({
        name: 'selfTraced',
        description: 'x',
        inputSchema: { type: 'object', additionalProperties: false },
        run: () => ({ done: true }),
      });
      const { gateway, telemetry } = setup();
      await declareExperimentalWebMcpTool(tool, TestBed.inject(Injector));
      const outcome = await gateway.callTool('selfTraced', {});
      expect(outcome).toMatchObject({ ok: true, result: { done: true } });
      expect(telemetry.entities().filter((p) => p.method === 'tools/call')).toHaveLength(1);
    });

    it('passes plain text results through and flags form failures as not ok', async () => {
      register('form', () => text(`${FORM_FAILURE_PREFIX}:\nstartDate: nope`));
      register('good', () => text('Form submitted successfully.'));
      const { gateway, telemetry } = setup();

      const failed = await gateway.callTool('form', {});
      expect(failed.ok).toBe(false);
      expect(failed.result).toBe(`${FORM_FAILURE_PREFIX}:\nstartDate: nope`);
      expect(telemetry.entities()[0]).toMatchObject({ status: 'error' });
      expect(telemetry.entities()[0]?.envelope.response?.error?.message).toContain('startDate');

      const good = await gateway.callTool('good', {});
      expect(good).toMatchObject({ ok: true, result: 'Form submitted successfully.' });
    });

    it('turns a thrown tool error into a failed result without the tool message', async () => {
      register('boom', () => {
        throw new Error('bad input');
      });
      const { gateway, telemetry } = setup();
      const outcome = await gateway.callTool('boom', {});
      expect(outcome).toMatchObject({
        ok: false,
        result: { error: 'UnknownError: Tool execution failed' },
      });
      expect(telemetry.entities()[0]).toMatchObject({ status: 'error' });
    });

    it('keeps the validation message of a defineTool failure readable to the model', async () => {
      const tool = defineTool<{ n: number }>({
        name: 'strict',
        description: 'x',
        inputSchema: {
          type: 'object',
          properties: { n: { type: 'number' } },
          required: ['n'],
          additionalProperties: false,
        },
        run: () => ({ done: true }),
      });
      const { gateway } = setup();
      await declareExperimentalWebMcpTool(tool, TestBed.inject(Injector));
      const outcome = await gateway.callTool('strict', { n: 'nope' });
      expect(outcome.ok).toBe(false);
      expect(JSON.stringify(outcome.result)).toContain('n');
      expect(JSON.stringify(outcome.result)).toContain('Invalid input for strict');
      expect(JSON.stringify(outcome.result)).not.toContain('Tool execution failed');
    });

    it('decodes a bare serialized string and non-JSON text', async () => {
      register('bare', () => 'Form submitted successfully.' as never);
      const { gateway } = setup();
      expect(await gateway.callTool('bare', {})).toMatchObject({
        ok: true,
        result: 'Form submitted successfully.',
      });
    });

    it('answers an unknown tool with an error result instead of throwing', async () => {
      const { gateway } = setup();
      const outcome = await gateway.callTool('missing', {});
      expect(outcome.ok).toBe(false);
      expect(outcome.result).toEqual({ error: 'Unknown tool: missing' });
    });

    it('honours isError and non-content results', async () => {
      register('flagged', () => ({ content: [{ type: 'text', text: 'x' }], isError: true }));
      register('raw', () => ({ answer: 42 }));
      register('nothing', () => null);
      const { gateway } = setup();
      expect((await gateway.callTool('flagged', {})).ok).toBe(false);
      expect(await gateway.callTool('raw', {})).toMatchObject({ ok: true, result: { answer: 42 } });
      expect(await gateway.callTool('nothing', {})).toMatchObject({ ok: true, result: null });
    });

    it('aborts the running tool and fails the call when the caller aborts', async () => {
      let received: AbortSignal | undefined;
      register('watch', ((_: never, client?: { signal?: AbortSignal }) => {
        received = client?.signal;
        return new Promise(() => undefined);
      }) as never);
      const { gateway } = setup();
      const controller = new AbortController();
      const running = gateway.callTool('watch', {}, controller.signal);
      await vi.waitFor(() => expect(received).toBeDefined());
      controller.abort();
      expect((await running).ok).toBe(false);
      expect(received?.aborted).toBe(true);
    });

    it('does not run a tool when the caller is already aborted', async () => {
      const execute = vi.fn(() => text('1'));
      register('skipped', execute);
      const { gateway } = setup();
      const outcome = await gateway.callTool('skipped', {}, AbortSignal.abort());
      expect(outcome.ok).toBe(false);
      expect(execute).not.toHaveBeenCalled();
    });

    it('records a failed call for an unknown tool even if it was once instrumented', async () => {
      const tool = defineTool<Record<string, never>>({
        name: 'formerTool',
        description: 'x',
        inputSchema: { type: 'object', additionalProperties: false },
        run: () => null,
      });
      expect(tool.name).toBe('formerTool');
      const { gateway, telemetry } = setup();
      const outcome = await gateway.callTool('formerTool', {});
      expect(outcome.ok).toBe(false);
      expect(telemetry.entities().filter((p) => p.method === 'tools/call')).toHaveLength(1);
    });

    it('fails cleanly when there is no registry', async () => {
      const { gateway, telemetry } = setup();
      (document as unknown as { modelContext?: unknown }).modelContext = undefined;
      const outcome = await gateway.callTool('any', {});
      expect(outcome.ok).toBe(false);
      expect(telemetry.entities()[0]).toMatchObject({ status: 'error' });
    });

    it('records nothing while telemetry is paused', async () => {
      register('quiet');
      const { gateway, telemetry } = setup();
      telemetry.pause();
      await gateway.callTool('quiet', {});
      expect(telemetry.entities()).toHaveLength(0);
    });
  });

  describe('tool discovery', () => {
    it('emits the added and removed diff and bumps toolsVersion', async () => {
      const { gateway, telemetry } = setup();
      expect(gateway.toolsVersion()).toBe(0);

      const form = register('draftDealProposal');
      await flush();
      expect(gateway.toolsVersion()).toBe(1);
      expect(gateway.lastChange()).toEqual({
        added: ['draftDealProposal'],
        removed: [],
        version: 1,
      });
      expect(gateway.tools().map((t) => t.name)).toEqual(['draftDealProposal']);

      form.abort();
      await flush();
      expect(gateway.toolsVersion()).toBe(2);
      expect(gateway.lastChange()).toEqual({
        added: [],
        removed: ['draftDealProposal'],
        version: 2,
      });
      expect(gateway.tools()).toEqual([]);

      const packets = telemetry
        .entities()
        .filter((p) => p.method === 'notifications/tools/list_changed');
      expect(packets).toHaveLength(2);
      expect(packets[0]?.envelope.request.params).toEqual({
        added: ['draftDealProposal'],
        removed: [],
      });
      expect(packets[0]?.envelope.request.id).toBeUndefined();
    });

    it('groups a burst of registrations into one change', async () => {
      const { gateway, telemetry } = setup();
      register('a');
      register('b');
      register('c');
      await flush();
      expect(gateway.toolsVersion()).toBe(1);
      expect(gateway.lastChange()?.added).toEqual(['a', 'b', 'c']);
      expect(telemetry.entities()).toHaveLength(1);
    });

    it('ignores a toolchange that leaves the names the same', async () => {
      const { gateway } = setup();
      register('a');
      await flush();
      registry.current.dispatchEvent(new Event('toolchange'));
      await flush();
      expect(gateway.toolsVersion()).toBe(1);
    });

    it('starts from the tools that are already registered', async () => {
      register('existing');
      const { gateway } = setup();
      await vi.waitFor(() => expect(gateway.tools().map((t) => t.name)).toEqual(['existing']));
      expect(gateway.discovery()).toBe('ready');
      expect(gateway.toolsVersion()).toBe(0);
      register('later');
      await flush();
      expect(gateway.lastChange()?.added).toEqual(['later']);
    });
  });

  describe('waitForTool', () => {
    it('resolves immediately when the tool is already there', async () => {
      register('here');
      const { gateway } = setup();
      await expect(gateway.waitForTool('here', 50)).resolves.toBe(true);
    });

    it('resolves once the tool appears', async () => {
      const { gateway } = setup();
      const waiting = gateway.waitForTool('draftDealProposal', 1000);
      register('draftDealProposal');
      await expect(waiting).resolves.toBe(true);
    });

    it('resolves false on timeout', async () => {
      vi.useFakeTimers();
      try {
        const { gateway } = setup();
        const waiting = gateway.waitForTool('never', 500);
        await vi.advanceTimersByTimeAsync(500);
        await expect(waiting).resolves.toBe(false);
      } finally {
        vi.useRealTimers();
      }
    });

    it('resolves false when aborted, or when already aborted', async () => {
      const { gateway } = setup();
      const controller = new AbortController();
      const waiting = gateway.waitForTool('never', 5000, controller.signal);
      controller.abort();
      await expect(waiting).resolves.toBe(false);
      await expect(gateway.waitForTool('never', 5000, controller.signal)).resolves.toBe(false);
    });

    it('resolves false when there is no registry', async () => {
      const { gateway } = setup();
      (document as unknown as { modelContext?: unknown }).modelContext = undefined;
      await expect(gateway.waitForTool('x', 10)).resolves.toBe(false);
    });
  });

  describe('discovery robustness', () => {
    it('does not let a slow older read resurrect a removed tool', async () => {
      const controller = register('late');
      const { gateway } = setup();
      await vi.waitFor(() => expect(gateway.tools()).toHaveLength(1));

      const real = registry.current.getTools.bind(registry.current);
      let release!: () => void;
      const gate = new Promise<void>((resolve) => (release = resolve));
      let calls = 0;
      vi.spyOn(registry.current, 'getTools').mockImplementation(async () => {
        const snapshot = await real();
        if (++calls === 1) {
          await gate;
        }
        return snapshot;
      });

      registry.current.dispatchEvent(new Event('toolchange'));
      await flush();
      controller.abort();
      await flush();
      expect(gateway.tools()).toEqual([]);

      release();
      await flush();
      expect(gateway.tools()).toEqual([]);
      expect(gateway.lastChange()?.removed).toEqual(['late']);
    });

    it('reports an error state when discovery fails and recovers on the next change', async () => {
      const spy = vi
        .spyOn(registry.current, 'getTools')
        .mockRejectedValueOnce(new Error('registry unavailable'));
      const { gateway } = setup();
      await vi.waitFor(() => expect(gateway.discovery()).toBe('error'));
      spy.mockRestore();
      register('back');
      await vi.waitFor(() => expect(gateway.discovery()).toBe('ready'));
      expect(gateway.tools().map((t) => t.name)).toEqual(['back']);
    });
  });
});
