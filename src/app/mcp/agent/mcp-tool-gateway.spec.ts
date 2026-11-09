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

  const flush = () => new Promise<void>((resolve) => queueMicrotask(resolve));

  describe('listTools', () => {
    it('returns the registry tools and records a tools/list packet', () => {
      register('alpha');
      register('beta');
      const { gateway, telemetry } = setup();
      expect(gateway.listTools().map((t) => t.name)).toEqual(['alpha', 'beta']);
      const [packet] = telemetry.entities();
      expect(packet).toMatchObject({ channel: 'mcp', method: 'tools/list', status: 'ok' });
      expect(packet?.envelope.response?.result).toEqual({ tools: ['alpha', 'beta'] });
    });

    it('returns nothing when no registry exists', () => {
      const { gateway } = setup();
      (document as unknown as { modelContext?: unknown }).modelContext = undefined;
      expect(gateway.listTools()).toEqual([]);
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

    it('turns a thrown tool error into a failed result', async () => {
      register('boom', () => {
        throw new Error('bad input');
      });
      const { gateway, telemetry } = setup();
      const outcome = await gateway.callTool('boom', {});
      expect(outcome).toMatchObject({ ok: false, result: { error: 'bad input' } });
      expect(telemetry.entities()[0]).toMatchObject({ status: 'error' });
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
      register('empty', () => undefined);
      const { gateway } = setup();
      expect((await gateway.callTool('flagged', {})).ok).toBe(false);
      expect(await gateway.callTool('raw', {})).toMatchObject({ ok: true, result: { answer: 42 } });
      expect(await gateway.callTool('empty', {})).toMatchObject({ ok: true, result: null });
    });

    it('forwards the abort signal to the tool', async () => {
      let received: AbortSignal | undefined;
      register('watch', ((_: never, client?: { signal?: AbortSignal }) => {
        received = client?.signal;
        return text('1');
      }) as never);
      const { gateway } = setup();
      const controller = new AbortController();
      await gateway.callTool('watch', {}, controller.signal);
      expect(received).toBe(controller.signal);
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
      expect(gateway.tools().map((t) => t.name)).toEqual(['existing']);
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
});
