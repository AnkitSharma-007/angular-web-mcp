import { ListboxHarness } from '@angular/aria/listbox/testing';
import { TestbedHarnessEnvironment } from '@angular/cdk/testing/testbed';
import { TestBed } from '@angular/core/testing';
import { MatTabGroupHarness } from '@angular/material/tabs/testing';
import { expectNoA11yViolations } from '../../../testing/a11y';
import { useFakeModelContext } from '../../../testing/test-providers';
import { WireTelemetryStore } from '../../mcp/telemetry/wire-telemetry-store';
import { LayoutStore } from '../layout/layout-store';
import { WireInspector } from './wire-inspector';

const text = (value: string) => ({ content: [{ type: 'text', text: value }] });

describe('WireInspector', () => {
  const registry = useFakeModelContext();

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  function register(name: string, extra: Record<string, unknown> = {}) {
    const controller = new AbortController();
    registry.current.registerTool(
      { name, description: `${name} description`, execute: () => text('{}'), ...extra },
      { signal: controller.signal },
    );
    return controller;
  }

  async function render() {
    const fixture = TestBed.createComponent(WireInspector);
    await fixture.whenStable();
    const root = fixture.nativeElement as HTMLElement;
    const loader = TestbedHarnessEnvironment.loader(fixture);
    const q = <T extends HTMLElement>(testId: string) =>
      root.querySelector<T>(`[data-testid="${testId}"]`);
    const tabs = () => loader.getHarness(MatTabGroupHarness);
    const openTab = async (label: string) => {
      await (await tabs()).selectTab({ label });
      await fixture.whenStable();
    };
    const settle = async () => {
      await fixture.whenStable();
      await new Promise((resolve) => setTimeout(resolve));
      await fixture.whenStable();
    };
    return {
      fixture,
      root,
      loader,
      q,
      openTab,
      settle,
      telemetry: TestBed.inject(WireTelemetryStore),
      layout: TestBed.inject(LayoutStore),
    };
  }

  type Rendered = Awaited<ReturnType<typeof render>>;

  function seedPackets({ telemetry }: Rendered) {
    const call = telemetry.record(
      { channel: 'mcp', method: 'tools/call', params: { name: 'searchDeals', arguments: {} } },
      { status: 'ok', latencyMs: 12, result: { total: 3 } },
    );
    const failed = telemetry.record(
      { channel: 'mcp', method: 'tools/call', params: { name: 'getDealDetails', arguments: {} } },
      { status: 'error', latencyMs: 4, error: 'Unknown deal' },
    );
    const rejected = telemetry.record(
      { channel: 'hitl', method: 'hitl/resolved', params: { toolName: 'terminateContract' } },
      { status: 'rejected', latencyMs: 2500, result: { approved: false, waitMs: 2500 } },
    );
    const llm = telemetry.record(
      { channel: 'llm', method: 'generateContent', model: 'gemini-3.8-flash', runId: 'run-1' },
      {
        status: 'ok',
        latencyMs: 1500,
        tokens: { input: 1200, output: 80, thinking: 40 },
        costUsd: 0.0012,
      },
    );
    const pending = telemetry.begin({ channel: 'mcp', method: 'tools/list' });
    return { call, failed, rejected, llm, pending };
  }

  describe('packets', () => {
    it('explains that there is nothing to show yet', async () => {
      const { q } = await render();
      expect(q('packets-empty')).not.toBeNull();
      expect(q('detail-empty')).not.toBeNull();
    });

    it('lists the newest packet first with latency, tokens and cost', async () => {
      const view = await render();
      const ids = seedPackets(view);
      await view.fixture.whenStable();
      const rows = [...view.root.querySelectorAll('[ngOption]')];
      expect(rows.map((row) => row.getAttribute('data-testid'))).toEqual([
        `packet-${ids.pending}`,
        `packet-${ids.llm}`,
        `packet-${ids.rejected}`,
        `packet-${ids.failed}`,
        `packet-${ids.call}`,
      ]);
      const llm = view.q(`packet-${ids.llm}`);
      expect(llm?.textContent).toContain('generateContent · gemini-3.8-flash');
      expect(llm?.querySelector('[data-testid="row-latency"]')?.textContent).toContain('1.5 s');
      expect(llm?.querySelector('[data-testid="row-tokens"]')?.textContent).toContain(
        '1200 in · 80 out · 40 think',
      );
      expect(llm?.querySelector('[data-testid="row-cost"]')?.textContent).toContain('$0.0012');
      expect(view.q(`packet-${ids.call}`)?.querySelector('[data-testid="row-cost"]')).toBeNull();
    });

    it('styles rows by channel and status', async () => {
      const view = await render();
      const ids = seedPackets(view);
      await view.fixture.whenStable();
      const call = view.q(`packet-${ids.call}`);
      const failed = view.q(`packet-${ids.failed}`);
      const rejected = view.q(`packet-${ids.rejected}`);
      const pending = view.q(`packet-${ids.pending}`);
      expect(call?.getAttribute('data-channel')).toBe('mcp');
      expect(call?.getAttribute('data-status')).toBe('ok');
      expect(call?.classList.contains('text-on-surface')).toBe(true);
      expect(failed?.getAttribute('data-status')).toBe('error');
      expect(failed?.classList.contains('text-error')).toBe(true);
      expect(failed?.textContent).toContain('Error');
      expect(rejected?.getAttribute('data-channel')).toBe('hitl');
      expect(rejected?.textContent).toContain('Rejected');
      expect(pending?.getAttribute('data-status')).toBe('pending');
      expect(pending?.classList.contains('text-on-surface-variant')).toBe(true);
      expect(pending?.querySelector('[data-testid="row-latency"]')?.textContent).toContain('…');
      const badge = (el: Element | null | undefined) => el?.querySelector('span')?.className ?? '';
      expect(badge(call)).toContain('text-primary');
      expect(badge(view.q(`packet-${ids.llm}`))).toContain('--mat-sys-tertiary');
    });

    it('shows the envelope of the clicked packet', async () => {
      const view = await render();
      const ids = seedPackets(view);
      await view.fixture.whenStable();
      const listbox = await view.loader.getHarness(ListboxHarness);
      const [option] = await listbox.getOptions({ text: /searchDeals/ });
      await option?.click();
      await view.fixture.whenStable();
      const detail = view.q('packet-detail');
      expect(detail?.textContent).toContain('tools/call · searchDeals');
      expect(detail?.querySelector('[data-testid="detail-status"]')?.textContent).toBe('OK');
      expect(detail?.textContent).toContain('"tools/call"');
      expect(detail?.textContent).toContain('total');
      expect(view.q(`packet-${ids.call}`)?.getAttribute('aria-selected')).toBe('true');
      expect(view.q('detail-empty')).toBeNull();
    });

    it('selects with the keyboard', async () => {
      const view = await render();
      const ids = seedPackets(view);
      await view.fixture.whenStable();
      const list = view.root.querySelector<HTMLElement>('[ngListbox]')!;
      list.focus();
      const press = async (key: string) => {
        list.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true }));
        await view.fixture.whenStable();
      };
      await press('ArrowDown');
      await press('ArrowDown');
      const selected = view.root.querySelector('[ngOption][aria-selected="true"]');
      expect(selected?.getAttribute('data-testid')).toBe(`packet-${ids.rejected}`);
      expect(view.q('packet-detail')?.textContent).toContain('hitl/resolved');
      await press('End');
      expect(
        view.root.querySelector('[ngOption][aria-selected="true"]')?.getAttribute('data-testid'),
      ).toBe(`packet-${ids.call}`);
      await press('Home');
      expect(
        view.root.querySelector('[ngOption][aria-selected="true"]')?.getAttribute('data-testid'),
      ).toBe(`packet-${ids.pending}`);
    });

    it('shows a response once a pending packet settles', async () => {
      const view = await render();
      const id = view.telemetry.begin({ channel: 'mcp', method: 'tools/list' });
      await view.fixture.whenStable();
      view.root.querySelector<HTMLElement>(`[data-testid="packet-${id}"]`)?.click();
      await view.fixture.whenStable();
      expect(view.q('packet-detail')?.textContent).toContain('Waiting for a response');
      view.telemetry.end(id, { status: 'ok', result: { tools: [] } });
      await view.fixture.whenStable();
      expect(view.q('packet-detail')?.textContent).not.toContain('Waiting for a response');
      expect(view.q('packet-detail')?.textContent).toContain('Response');
    });

    it('only lists the packets of the run it is filtered to', async () => {
      const view = await render();
      const ids = seedPackets(view);
      view.layout.showRun('run-1');
      await view.fixture.whenStable();
      expect([...view.root.querySelectorAll('[ngOption]')]).toHaveLength(1);
      expect(view.q(`packet-${ids.llm}`)).not.toBeNull();
      expect(view.q('run-filter')?.textContent).toContain('run-1');
      view.q<HTMLButtonElement>('run-filter')?.click();
      await view.fixture.whenStable();
      expect([...view.root.querySelectorAll('[ngOption]')]).toHaveLength(5);
      expect(view.q('run-filter')).toBeNull();
      expect(view.layout.inspectorRunId()).toBeNull();
    });

    it('drops the detail of a packet that is filtered out', async () => {
      const view = await render();
      const ids = seedPackets(view);
      view.q<HTMLElement>(`packet-${ids.call}`)?.click();
      await view.fixture.whenStable();
      expect(view.q('packet-detail')).not.toBeNull();
      view.layout.showRun('run-1');
      await view.fixture.whenStable();
      expect(view.q('packet-detail')?.textContent).not.toContain('searchDeals');
    });
  });

  describe('tools', () => {
    it('lists the registered tools with their hints and schema', async () => {
      register('searchDeals', {
        annotations: { readOnlyHint: true, consequentialHint: false },
        inputSchema: { type: 'object', properties: { query: { type: 'string' } } },
      });
      register('terminateContract', { annotations: { consequentialHint: true } });
      const view = await render();
      await view.openTab('Tools');
      await view.settle();
      expect(view.q('tools-count')?.textContent).toContain('2 tools registered');
      const search = view.q('tool-searchDeals');
      expect(search?.textContent).toContain('searchDeals description');
      expect(
        [...(search?.querySelectorAll('[data-testid="hint"]') ?? [])].map((hint) =>
          hint.textContent?.trim(),
        ),
      ).toEqual(['readOnlyHint']);
      expect(search?.querySelector('details')?.textContent).toContain('query');
      expect(view.q('tool-terminateContract')?.querySelector('details')).toBeNull();
      expect(view.root.querySelector('[data-testid="new-badge"]')).toBeNull();
    });

    it('says when nothing is registered', async () => {
      const view = await render();
      await view.openTab('Tools');
      await view.settle();
      expect(view.q('tools-count')?.textContent).toContain('0 tools registered');
    });

    it('highlights a tool that was just added', async () => {
      register('searchDeals');
      const view = await render();
      await view.openTab('Tools');
      await view.settle();
      register('draftDealProposal');
      await view.settle();
      expect(view.q('tools-count')?.textContent).toContain('2 tools');
      expect(view.q('tool-draftDealProposal')?.getAttribute('data-new')).toBe('true');
      expect(
        view.q('tool-draftDealProposal')?.querySelector('[data-testid="new-badge"]'),
      ).not.toBeNull();
      expect(view.q('tool-searchDeals')?.getAttribute('data-new')).toBe('false');
    });

    it('refreshes when a tool goes away', async () => {
      register('searchDeals');
      const form = register('draftDealProposal');
      const view = await render();
      await view.openTab('Tools');
      await view.settle();
      expect(view.q('tool-draftDealProposal')).not.toBeNull();
      form.abort();
      await view.settle();
      expect(view.q('tool-draftDealProposal')).toBeNull();
      expect(view.q('tools-count')?.textContent).toContain('1 tool registered');
    });
  });

  describe('stats', () => {
    it('shows the latency percentiles, error rate and human wait', async () => {
      const view = await render();
      seedPackets(view);
      await view.openTab('Stats');
      const stats = view.q('stats')?.textContent ?? '';
      expect(stats).toContain('Packets');
      expect(stats).toContain('5');
      expect(stats).toContain('50%');
      expect(stats).toContain('1 failed · 0 rejected');
      expect(stats).toContain('12 ms');
      expect(stats).toContain('2.5 s');
      expect(stats).toContain('1 decisions');
    });

    describe('scoped to a run', () => {
      function seedTwoRuns({ telemetry }: Rendered) {
        const call = (runId: string, latencyMs: number, status: 'ok' | 'error') =>
          telemetry.record(
            { channel: 'mcp', method: 'tools/call', runId, params: { name: 'x', arguments: {} } },
            { status, latencyMs },
          );
        call('run-a', 10, 'ok');
        call('run-a', 30, 'ok');
        call('run-b', 90, 'error');
        for (const [runId, cost] of [
          ['run-a', 0.001],
          ['run-b', 0.01],
        ] as const) {
          telemetry.record(
            { channel: 'llm', method: 'generateContent', model: 'gemini-3.8-flash', runId },
            {
              status: 'ok',
              latencyMs: 100,
              tokens: { input: 100, output: 10, thinking: 0 },
              costUsd: cost,
            },
          );
        }
        telemetry.record(
          { channel: 'hitl', method: 'hitl/resolved', runId: 'run-b' },
          { status: 'ok', latencyMs: 4000 },
        );
      }

      it('computes stats, model rows and human wait from the selected run only', async () => {
        const view = await render();
        seedTwoRuns(view);
        view.layout.showRun('run-a');
        await view.openTab('Stats');

        const stats = view.q('stats')?.textContent ?? '';
        expect(view.q('stats-scope')?.textContent).toContain('Run run-a only');
        expect(stats).toContain('0%');
        expect(stats).toContain('30 ms');
        expect(stats).not.toContain('90 ms');
        expect(stats).toContain('0 decisions');
        expect(view.q('model-row-gemini-3.8-flash')?.textContent).toContain('0.001');
      });

      it('restores the global numbers when the filter is cleared', async () => {
        const view = await render();
        seedTwoRuns(view);
        view.layout.showRun('run-a');
        await view.openTab('Stats');
        view.layout.showRun(null);
        await view.fixture.whenStable();

        const stats = view.q('stats')?.textContent ?? '';
        expect(view.q('stats-scope')?.textContent).toContain('All retained traffic');
        expect(stats).toContain('33%');
        expect(stats).toContain('1 decisions');
        expect(view.q('model-row-gemini-3.8-flash')?.textContent).toContain('0.011');
      });

      it('copies only the selected run, and says which run it is', async () => {
        const writeText = vi.fn().mockResolvedValue(undefined);
        vi.stubGlobal('navigator', { clipboard: { writeText } });
        const view = await render();
        seedTwoRuns(view);
        view.layout.showRun('run-a');
        await view.fixture.whenStable();
        view.q<HTMLButtonElement>('copy')?.click();
        await view.settle();

        const exported = JSON.parse(writeText.mock.calls[0]?.[0] as string) as {
          runId: string;
          packets: { runId: string }[];
        };
        expect(exported.runId).toBe('run-a');
        expect(exported.packets).toHaveLength(3);
        expect(exported.packets.every((packet) => packet.runId === 'run-a')).toBe(true);
      });
    });

    it('breaks the model calls down by model', async () => {
      const view = await render();
      seedPackets(view);
      view.telemetry.record(
        { channel: 'llm', method: 'generateContent', model: 'gemini-3.5-flash-lite' },
        {
          status: 'ok',
          latencyMs: 500,
          tokens: { input: 300, output: 20, thinking: 0 },
          costUsd: 0.0003,
        },
      );
      await view.openTab('Stats');
      const row = view.q('model-row-gemini-3.8-flash');
      expect(row?.textContent).toContain('1200');
      expect(row?.textContent).toContain('80');
      expect(row?.textContent).toContain('1,500 ms');
      expect(row?.querySelector('[data-testid="model-cost"]')?.textContent).toContain('0.0012');
      expect(view.q('model-row-gemini-3.5-flash-lite')).not.toBeNull();
      expect(view.q('models-empty')).toBeNull();
    });

    it('says when there are no model calls', async () => {
      const view = await render();
      await view.openTab('Stats');
      expect(view.q('models-empty')).not.toBeNull();
      expect(view.q('by-model')).toBeNull();
    });
  });

  describe('controls', () => {
    it('pauses and resumes recording', async () => {
      const view = await render();
      view.q<HTMLButtonElement>('pause')?.click();
      await view.fixture.whenStable();
      expect(view.telemetry.paused()).toBe(true);
      expect(view.q('pause')?.getAttribute('aria-pressed')).toBe('true');
      expect(view.q('pause')?.textContent).toContain('Resume');
      expect(view.q('paused-badge')).not.toBeNull();
      expect(view.telemetry.begin({ channel: 'mcp', method: 'tools/list' })).toBe(0);
      view.q<HTMLButtonElement>('pause')?.click();
      await view.fixture.whenStable();
      expect(view.telemetry.paused()).toBe(false);
      expect(view.q('pause')?.textContent).toContain('Pause');
      expect(view.q('paused-badge')).toBeNull();
    });

    it('clears the packets and the selection', async () => {
      const view = await render();
      const ids = seedPackets(view);
      view.q<HTMLElement>(`packet-${ids.call}`)?.click();
      await view.fixture.whenStable();
      view.q<HTMLButtonElement>('clear')?.click();
      await view.fixture.whenStable();
      expect(view.telemetry.entities()).toHaveLength(0);
      expect(view.q('packets-empty')).not.toBeNull();
      expect(view.q('packet-detail')).toBeNull();
    });

    it('copies the packets as JSON', async () => {
      const writeText = vi.fn().mockResolvedValue(undefined);
      vi.stubGlobal('navigator', { clipboard: { writeText } });
      const view = await render();
      seedPackets(view);
      view.q<HTMLButtonElement>('copy')?.click();
      await view.settle();
      expect(writeText).toHaveBeenCalledWith(view.telemetry.exportJson());
      expect(JSON.parse(writeText.mock.calls[0]?.[0] as string)).toHaveLength(5);
      expect(view.q('copy-status')?.textContent).toContain('Copied to clipboard');
    });

    it('reports a copy that the browser refused', async () => {
      vi.stubGlobal('navigator', {
        clipboard: { writeText: vi.fn().mockRejectedValue(new Error('denied')) },
      });
      const view = await render();
      view.q<HTMLButtonElement>('copy')?.click();
      await view.settle();
      expect(view.q('copy-status')?.textContent).toContain('Copy failed');
    });

    it('forgets the copy message after a moment', async () => {
      vi.stubGlobal('navigator', {
        clipboard: { writeText: vi.fn().mockResolvedValue(undefined) },
      });
      const view = await render();
      vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
      view.q<HTMLButtonElement>('copy')?.click();
      await vi.advanceTimersByTimeAsync(0);
      view.fixture.detectChanges();
      expect(view.q('copy-status')?.textContent).toContain('Copied');
      await vi.advanceTimersByTimeAsync(2000);
      view.fixture.detectChanges();
      expect(view.q('copy-status')?.textContent?.trim()).toBe('');
    });

    it('closes from the button and with Escape', async () => {
      const view = await render();
      view.layout.toggleInspector();
      view.q<HTMLButtonElement>('close')?.click();
      expect(view.layout.inspectorOpen()).toBe(false);
      view.layout.toggleInspector();
      view
        .q('wire-inspector')
        ?.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
      expect(view.layout.inspectorOpen()).toBe(false);
      view
        .q('wire-inspector')
        ?.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
      expect(view.layout.inspectorOpen()).toBe(false);
    });
  });

  describe('accessibility', () => {
    it('is free of axe violations on every tab', async () => {
      register('searchDeals', {
        annotations: { readOnlyHint: true },
        inputSchema: { type: 'object', properties: { query: { type: 'string' } } },
      });
      const view = await render();
      const ids = seedPackets(view);
      view.layout.showRun(null);
      view.q<HTMLElement>(`packet-${ids.llm}`)?.click();
      await view.settle();
      await expectNoA11yViolations(view.root);
      await view.openTab('Tools');
      await view.settle();
      await expectNoA11yViolations(view.root);
      await view.openTab('Stats');
      await expectNoA11yViolations(view.root);
    });

    it('is free of axe violations when empty and filtered', async () => {
      const view = await render();
      view.layout.showRun('run-9');
      view.telemetry.pause();
      await view.fixture.whenStable();
      await expectNoA11yViolations(view.root);
    });
  });
});
