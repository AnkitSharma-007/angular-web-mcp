import { ApplicationRef } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { By } from '@angular/platform-browser';
import { MatDialog } from '@angular/material/dialog';
import { MatSnackBar } from '@angular/material/snack-bar';
import { Router } from '@angular/router';
import { ACT3_BILLING_DATE, ACT_SCRIPTS } from '../testing/act-scripts';
import { FakeGenAI, fakeGenAiFactory } from '../testing/fake-genai';
import { useFakeModelContext } from '../testing/test-providers';
import { App } from './app';
import { appConfig } from './app.config';
import { createSeedDeals } from './core/data/seed-deals';
import { EMPTY_FILTER } from './core/models/deal';
import type { ActId } from './features/agent-console/demo-prompts';
import { DashboardShell } from './features/dashboard/dashboard-shell';
import { DealsStore } from './features/dashboard/data/deals-store';
import { LayoutStore } from './features/layout/layout-store';
import { ProposalsStore } from './features/proposal/proposals-store';
import { SettingsStore } from './features/settings/settings-store';
import type { AgentEvent } from './mcp/agent/agent-events';
import { DiscoveryTracker } from './mcp/registry/discovery-tracker';
import { AgentSessionStore } from './mcp/agent/agent-session-store';
import { GENAI_CLIENT_FACTORY } from './mcp/agent/gemini/genai-client';
import { WireTelemetryStore } from './mcp/telemetry/wire-telemetry-store';

const KEY = 'AIza-acceptance-key-0001';
const TIME_BUDGET_MS = 5000;
const POLL_MS = 5;

type ToolResult = Extract<AgentEvent, { type: 'tool-result' }>;

const toolNames = (events: readonly AgentEvent[]) =>
  events.flatMap((event) => (event.type === 'tool-call' ? [event.name] : []));

const results = (events: readonly AgentEvent[]) =>
  events.filter((event): event is ToolResult => event.type === 'tool-result');

const answerOf = (events: readonly AgentEvent[]) =>
  events.flatMap((event) => (event.type === 'text-delta' ? [event.text] : [])).join('');

describe('demo acts', () => {
  const registry = useFakeModelContext();

  beforeAll(() => import('./mcp/agent/gemini/gemini-agent'));

  afterEach(() => {
    vi.useRealTimers();
    TestBed.inject(MatDialog).closeAll();
    TestBed.inject(MatSnackBar).dismiss();
    localStorage.clear();
    sessionStorage.clear();
    document.documentElement.classList.remove('dark');
  });

  async function startApp() {
    const fake = new FakeGenAI();
    TestBed.configureTestingModule({
      providers: [
        ...appConfig.providers,
        { provide: GENAI_CLIENT_FACTORY, useValue: fakeGenAiFactory(fake) },
      ],
    });
    const fixture = TestBed.createComponent(App);
    await TestBed.inject(Router).navigateByUrl('/dashboard');
    TestBed.inject(SettingsStore).saveKey(KEY, false);
    TestBed.inject(LayoutStore).openConsole();
    await fixture.whenStable();

    const root = fixture.nativeElement as HTMLElement;
    const shell = fixture.debugElement.query(By.directive(DashboardShell));
    const session = TestBed.inject(AgentSessionStore);
    const q = (testId: string) => root.querySelector<HTMLElement>(`[data-testid="${testId}"]`);

    const lastRun = (): AgentEvent[] => {
      const transcript = session.transcript();
      let start = 0;
      transcript.forEach((entry, index) => {
        if (entry.kind === 'user') {
          start = index;
        }
      });
      return transcript
        .slice(start)
        .flatMap((entry) => (entry.kind === 'event' ? [entry.event] : []));
    };

    const play = (act: ActId) => {
      fake.push(...ACT_SCRIPTS[act]());
      q(`chip-${act}`)?.click();
    };

    const settle = async () => {
      if (vi.isFakeTimers()) {
        await vi.advanceTimersByTimeAsync(0);
        TestBed.inject(ApplicationRef).tick();
      } else {
        await fixture.whenStable();
      }
    };

    const finish = async () => {
      await vi.waitFor(() => expect(['done', 'error']).toContain(lastRun().at(-1)?.type), {
        timeout: TIME_BUDGET_MS,
        interval: POLL_MS,
      });
      await settle();
    };

    const decide = async (choice: 'approve' | 'reject') => {
      await vi.waitFor(
        () => {
          TestBed.inject(ApplicationRef).tick();
          expect(document.querySelector('app-approval-dialog')).not.toBeNull();
        },
        { timeout: TIME_BUDGET_MS, interval: POLL_MS },
      );
      const dialog = document.querySelector('app-approval-dialog') as HTMLElement;
      const shown = dialog.textContent ?? '';
      document.querySelector<HTMLButtonElement>(`[data-testid="${choice}"]`)?.click();
      await vi.waitFor(() => expect(document.contains(dialog)).toBe(false), {
        timeout: TIME_BUDGET_MS,
        interval: POLL_MS,
      });
      return shown;
    };

    return {
      fake,
      fixture,
      root,
      q,
      session,
      lastRun,
      play,
      settle,
      finish,
      decide,
      deals: shell.injector.get(DealsStore),
      proposals: shell.injector.get(ProposalsStore),
      telemetry: TestBed.inject(WireTelemetryStore),
    };
  }

  type Demo = Awaited<ReturnType<typeof startApp>>;

  const snackbarText = () =>
    [...document.querySelectorAll('.mat-mdc-snack-bar-container')]
      .map((container) => container.textContent)
      .join(' ');

  async function playAct1(demo: Demo) {
    demo.play('act1');
    await demo.finish();
    const events = demo.lastRun();

    expect(toolNames(events)).toEqual(['getPipelineSummary', 'searchDeals']);
    expect(events.at(-1)?.type).toBe('done');
    expect(demo.fake.createdChats.at(-1)?.model).toBe('gemini-3.5-flash-lite');
    expect(demo.q('thought')).not.toBeNull();

    const stalled = demo.deals.search({ stalledOnly: true, limit: 5 }).deals;
    expect(stalled.length).toBeGreaterThan(0);
    for (const deal of stalled) {
      expect(answerOf(events)).toContain(deal.account);
    }
    expect(demo.q('agent-text')?.textContent).toContain(stalled[0]?.account);
    expect(demo.deals.history()).toHaveLength(0);
    expect(demo.deals.entities()).toEqual(createSeedDeals());
  }

  async function playAct2(demo: Demo) {
    const seed = createSeedDeals();
    const targets = seed.filter((deal) => deal.region === 'EMEA' && deal.stage === 'negotiation');
    expect(targets.some((deal) => deal.probability > 70)).toBe(true);

    demo.play('act2');
    await demo.finish();
    const events = demo.lastRun();

    expect(toolNames(events)).toEqual([
      'setDealFilter',
      'searchDeals',
      'applyBatchDiscount',
      'updateDealStages',
    ]);
    const calls = events.filter((event) => event.type === 'tool-call');
    expect(calls).toHaveLength(4);
    expect(results(events)).toHaveLength(4);
    expect(results(events).every((result) => result.ok)).toBe(true);
    expect(results(events).map((result) => result.callId)).toEqual(
      calls.map((call) => call.callId),
    );
    expect(document.querySelector('app-approval-dialog')).toBeNull();

    expect(demo.deals.filter()).toMatchObject({ regions: ['EMEA'], stages: ['negotiation'] });
    const now = demo.deals.entityMap();
    for (const target of targets) {
      expect(now[target.id]?.discountPct).toBe(10);
      expect(now[target.id]?.stage).toBe(target.probability > 70 ? 'closed-won' : 'negotiation');
    }
    const inScope = new Set(targets.map((deal) => deal.id));
    for (const original of seed.filter((deal) => !inScope.has(deal.id))) {
      expect(now[original.id]).toEqual(original);
    }
    const stillNegotiating = targets.filter((deal) => deal.probability <= 70);
    expect(demo.root.querySelectorAll('tr[mat-row]')).toHaveLength(stillNegotiating.length);
    expect(demo.deals.history()).toHaveLength(2);
    expect(snackbarText()).toContain(
      `Agent moved ${targets.filter((deal) => deal.probability > 70).length} deals`,
    );
  }

  async function playAct3(demo: Demo) {
    expect(registry.current.toolNames()).not.toContain('draftDealProposal');

    demo.play('act3');
    await demo.finish();
    const events = demo.lastRun();

    expect(toolNames(events)).toEqual([
      'searchDeals',
      'getDealDetails',
      'openProposalDrawer',
      'draftDealProposal',
      'draftDealProposal',
    ]);
    expect(
      events.some(
        (event) => event.type === 'tools-changed' && event.added.includes('draftDealProposal'),
      ),
    ).toBe(true);
    expect(registry.current.toolNames()).toContain('draftDealProposal');

    const [rejected, accepted] = results(events).filter(
      (result) => result.name === 'draftDealProposal',
    );
    expect(rejected?.ok).toBe(false);
    expect(String(rejected?.result)).toContain('startDate');
    expect(String(rejected?.result)).toContain('billing cycle');
    expect(accepted?.ok).toBe(true);

    expect(demo.proposals.entities()).toHaveLength(1);
    expect(demo.proposals.latest()).toMatchObject({
      dealId: 'D-1001',
      clientName: 'Konkan Freight',
      productTier: 'Enterprise',
      seats: 250,
      termMonths: 24,
      discountPct: 0,
      startDate: ACT3_BILLING_DATE,
    });
    const field = (name: string) =>
      demo.root.querySelector<HTMLInputElement>(`app-proposal-drawer [data-field="${name}"]`);
    expect(field('seats')?.value).toBe('250');
    expect(field('termMonths')?.value).toBe('24');
    expect(field('startDate')?.value).toBe(ACT3_BILLING_DATE);
    expect(demo.root.querySelector('app-proposal-drawer [data-testid="saved"]')).not.toBeNull();
    expect(answerOf(events)).toContain('Konkan Freight');
  }

  async function playAct4(demo: Demo) {
    const arcadiaBefore = demo.deals.entityMap()['D-1002']?.discountPct;

    demo.play('act4');
    const approval = await demo.decide('approve');
    expect(approval).toContain('Set a 25% discount on 1 deal');
    const termination = await demo.decide('reject');
    expect(termination).toContain('Critical action');
    expect(termination).toContain('Monsoon Retail');
    await demo.finish();
    const events = demo.lastRun();

    expect(toolNames(events)).toEqual([
      'searchDeals',
      'searchDeals',
      'applyBatchDiscount',
      'terminateContract',
    ]);
    expect(events.filter((event) => event.type === 'awaiting-approval')).toHaveLength(2);
    expect(demo.deals.entityMap()['D-1002']?.discountPct).toBe(25);
    expect(demo.deals.entityMap()['D-1003']?.contractStatus).toBe('active');

    const termResult = results(events).find((result) => result.name === 'terminateContract');
    expect(termResult?.ok).toBe(true);
    expect(termResult?.result).toMatchObject({ status: 'rejected_by_human' });
    expect(JSON.stringify(demo.fake.requests.at(-1)?.message)).toContain('rejected_by_human');
    expect(answerOf(events)).toContain('rejected by a human');
    expect(answerOf(events)).toContain('Monsoon Retail');

    const undo = document.querySelector<HTMLButtonElement>('.mat-mdc-snack-bar-action');
    expect(snackbarText()).toContain('25% discount');
    undo?.click();
    await demo.settle();
    expect(demo.deals.entityMap()['D-1002']?.discountPct).toBe(arcadiaBefore);
    expect(demo.telemetry.entities().some((packet) => packet.method === 'human/undo')).toBe(true);
  }

  async function reset(demo: Demo) {
    window.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'R', shiftKey: true, cancelable: true }),
    );
    await demo.settle();
    await vi.waitFor(() => expect(demo.root.querySelector('app-proposal-drawer')).toBeNull(), {
      timeout: TIME_BUDGET_MS,
      interval: POLL_MS,
    });
    await TestBed.inject(DiscoveryTracker).idle();
    await demo.settle();

    expect(demo.deals.entities()).toEqual(createSeedDeals());
    expect(demo.deals.filter()).toEqual(EMPTY_FILTER);
    expect(demo.deals.history()).toEqual([]);
    expect(demo.proposals.entities()).toEqual([]);
    expect(demo.session.transcript()).toEqual([]);
    expect(demo.root.querySelectorAll('app-transcript-item')).toHaveLength(0);
    expect(demo.telemetry.entities()).toEqual([]);
    expect(registry.current.toolNames()).not.toContain('draftDealProposal');
  }

  describe('one act at a time', () => {
    it('Act 1 · Context: reads the summary, searches stalled deals and cites them', async () => {
      await playAct1(await startApp());
    });

    it('Act 2 · Multi-step: filters, discounts and closes without asking a human', async () => {
      await playAct2(await startApp());
    });

    it('Act 3 · Signal Form: self-corrects the billing date and saves the draft', async () => {
      await playAct3(await startApp());
    });

    it('Act 4 · Governance: approve the discount, reject the termination, then undo', async () => {
      await playAct4(await startApp());
    });
  });

  it('opens cold with the eight tools and loses them when leaving the dashboard', async () => {
    const demo = await startApp();
    expect(registry.current.toolNames()).toHaveLength(8);
    await TestBed.inject(Router).navigateByUrl('/about');
    await demo.settle();
    expect(registry.current.toolNames()).toEqual([]);
    await TestBed.inject(Router).navigateByUrl('/dashboard');
    await demo.settle();
    expect(registry.current.toolNames()).toHaveLength(8);
  });

  it('plays the four acts back to back on one app, resets, and stays under five seconds', async () => {
    const demo = await startApp();
    vi.useFakeTimers({
      toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'Date'],
    });
    const startedAt = Date.now();

    await playAct1(demo);
    await playAct2(demo);
    await playAct3(demo);
    await playAct4(demo);
    expect(demo.session.transcript().filter((entry) => entry.kind === 'user')).toHaveLength(4);
    expect(Date.now() - startedAt).toBeLessThan(TIME_BUDGET_MS);

    await reset(demo);
    expect(Date.now() - startedAt).toBeLessThan(TIME_BUDGET_MS);
  });
});
