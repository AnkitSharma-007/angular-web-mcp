import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { expectNoA11yViolations } from '../../../testing/a11y';
import { FakeApiError, FakeGenAI, fakeGenAiFactory } from '../../../testing/fake-genai';
import { makeOutcome, passingOutcome, toolCall } from '../../../testing/run-outcomes';
import { CLOCK } from '../../core/util/clock';
import { GENAI_CLIENT_FACTORY } from '../../mcp/agent/gemini/genai-client';
import { PresenterActions } from '../agent-console/presenter-actions';
import { LayoutStore } from '../layout/layout-store';
import { ApiKeyDialogLauncher } from '../settings/api-key-dialog-launcher';
import { SettingsStore } from '../settings/settings-store';
import { ACT_EVALS } from './act-evals';
import { IsolatedRunner, type IsolatedRunOptions, type RunOutcome } from './isolated-run';
import { LabPage } from './lab-page';

type Handler = (options: IsolatedRunOptions) => Promise<RunOutcome>;

const NOW = new Date('2026-11-09T10:00:00Z');

const defaultOutcome: Handler = (options) =>
  Promise.resolve(
    makeOutcome({
      runId: `run-${options.model}`,
      model: options.model,
      text: `Answer from ${options.model}`,
      ms: options.model === 'gemini-3.5-flash-lite' ? 1200 : 3400,
      toolCalls: [toolCall('getPipelineSummary'), toolCall('searchDeals')],
      usage: { input: 5000, output: 400, thinking: 700 },
      costUsd: 0.0123,
    }),
  );

function setup(
  handler: Handler = defaultOutcome,
  { key = true, listError }: { key?: boolean; listError?: unknown } = {},
) {
  localStorage.clear();
  sessionStorage.clear();
  const open = vi.fn().mockResolvedValue(true);
  const evalMode = signal(false);
  const runner = {
    run: vi.fn(handler),
    beginBatch: vi.fn(() => () => undefined),
    evalMode,
  };
  const fake = new FakeGenAI();
  if (listError !== undefined) {
    fake.listError = listError;
  }
  TestBed.configureTestingModule({
    providers: [
      { provide: IsolatedRunner, useValue: runner },
      { provide: ApiKeyDialogLauncher, useValue: { open } },
      { provide: CLOCK, useValue: () => NOW },
      { provide: GENAI_CLIENT_FACTORY, useValue: fakeGenAiFactory(fake) },
    ],
  });
  const settings = TestBed.inject(SettingsStore);
  if (key) {
    settings.saveKey('AIza-test-key-0001', false);
  }
  const fixture = TestBed.createComponent(LabPage);
  const root = fixture.nativeElement as HTMLElement;
  const q = <T extends HTMLElement>(testId: string) =>
    root.querySelector<T>(`[data-testid="${testId}"]`);
  const click = async (testId: string) => {
    q<HTMLElement>(testId)?.click();
    await fixture.whenStable();
  };
  return {
    fixture,
    root,
    q,
    click,
    runner,
    open,
    evalMode,
    settings,
    layout: TestBed.inject(LayoutStore),
  };
}

const evalAct = (prompt: string) =>
  ACT_EVALS.find((spec) => spec.prompts.includes(prompt))?.id ?? 'act1';

describe('LabPage', () => {
  afterEach(() => {
    localStorage.clear();
    sessionStorage.clear();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  describe('leaving or resetting while a run is active', () => {
    function hanging() {
      const signals: AbortSignal[] = [];
      const handler: Handler = (options) => {
        if (options.signal) {
          signals.push(options.signal);
        }
        return new Promise<RunOutcome>((resolve) =>
          options.signal?.addEventListener('abort', () => resolve(passingOutcome('act1')), {
            once: true,
          }),
        );
      };
      return { signals, handler };
    }

    it('aborts an eval batch when the page is destroyed', async () => {
      const { signals, handler } = hanging();
      const { fixture, click } = setup(handler);
      await fixture.whenStable();
      await click('eval-run');
      await vi.waitFor(() => expect(signals.length).toBeGreaterThan(0));
      fixture.destroy();
      expect(signals.every((signal) => signal.aborted)).toBe(true);
    });

    it('aborts an active eval batch and stops queueing more on a presenter reset', async () => {
      const { signals, handler } = hanging();
      const { fixture, click, runner } = setup(handler);
      await fixture.whenStable();
      await click('eval-run');
      await vi.waitFor(() => expect(signals.length).toBeGreaterThan(0));
      const started = runner.run.mock.calls.length;
      TestBed.inject(PresenterActions).reset();
      await vi.waitFor(() => expect(signals.every((signal) => signal.aborted)).toBe(true));
      await fixture.whenStable();
      expect(runner.run.mock.calls.length).toBe(started);
    });
  });

  describe('without a valid key', () => {
    it('disables Run everywhere and explains why', async () => {
      const { fixture, q } = setup(defaultOutcome, { key: false });
      await fixture.whenStable();
      expect(q('key-required')?.textContent).toContain('Add your Gemini API key');
      expect(q<HTMLButtonElement>('eval-run')?.disabled).toBe(true);
    });

    it('opens the key dialog from the notice', async () => {
      const { fixture, click, open } = setup(defaultOutcome, { key: false });
      await fixture.whenStable();
      await click('add-key');
      expect(open).toHaveBeenCalledOnce();
    });

    it('says so when Google rejected the key', async () => {
      const { fixture, q, settings } = setup(defaultOutcome, {
        listError: new FakeApiError(401, 'bad'),
      });
      await vi.waitFor(() => {
        TestBed.tick();
        expect(settings.keyStatus()).toBe('invalid');
      });
      await fixture.whenStable();
      expect(q('key-required')?.textContent).toContain('rejected');
      expect(q('add-key')?.textContent).toContain('Replace API key');
      expect(q<HTMLButtonElement>('eval-run')?.disabled).toBe(true);
    });

    it('hides the notice when the key is fine', async () => {
      const { fixture, q } = setup();
      await fixture.whenStable();
      expect(q('key-required')).toBeNull();
    });
  });

  describe('eval mode banner', () => {
    it('appears while the runner holds eval mode and goes away afterwards', async () => {
      const { fixture, q, evalMode } = setup();
      await fixture.whenStable();
      expect(q('eval-banner')).toBeNull();
      evalMode.set(true);
      await fixture.whenStable();
      expect(q('eval-banner')?.getAttribute('role')).toBe('status');
      expect(q('eval-banner')?.textContent).toContain('Eval mode');
      evalMode.set(false);
      await fixture.whenStable();
      expect(q('eval-banner')).toBeNull();
    });
  });

  describe('act evals', () => {
    const passing: Handler = (options) =>
      Promise.resolve(passingOutcome(evalAct(options.prompt), { model: options.model }));

    const failingAct2: Handler = (options) => {
      const id = evalAct(options.prompt);
      const outcome = passingOutcome(id, {
        model: options.model,
        prompt: options.prompt,
        runId: `run-${id}-${options.prompt.length}`,
      });
      return Promise.resolve(
        id === 'act2' ? { ...outcome, toolCalls: [toolCall('searchDeals')] } : outcome,
      );
    };

    async function runEvals(handler: Handler) {
      const ctx = setup(handler);
      await ctx.fixture.whenStable();
      await ctx.click('eval-run');
      await vi.waitFor(() => expect(ctx.q('eval-table')).not.toBeNull());
      await vi.waitFor(() =>
        expect(ctx.q('eval-progress')?.textContent).toContain('20 of 20 runs'),
      );
      await ctx.fixture.whenStable();
      return ctx;
    }

    it('starts with 5 runs per act selected and nothing run yet', async () => {
      const { fixture, q } = setup();
      await fixture.whenStable();
      expect(q<HTMLInputElement>('eval-runs-5')?.checked).toBe(true);
      expect(q<HTMLInputElement>('eval-runs-10')?.checked).toBe(false);
      expect(q('eval-table')).toBeNull();
      expect(q('eval-estimate')?.textContent).toMatch(/≈ \$\d+\.\d{2}/);
    });

    it('switches to 10 runs per act', async () => {
      const { fixture, q, click, runner } = setup(passing);
      await fixture.whenStable();
      await click('eval-runs-10');
      await click('eval-act-act1');
      await click('eval-act-act2');
      await click('eval-act-act3');
      await click('eval-run');
      await vi.waitFor(() => expect(q('eval-progress')?.textContent).toContain('10 of 10 runs'));
      expect(runner.run).toHaveBeenCalledTimes(10);
    });

    it('shows a row per act with pass count, rate and times', async () => {
      const { q, root } = await runEvals(passing);
      expect(root.querySelectorAll('[data-testid^="eval-row-"]')).toHaveLength(4);
      expect(q('eval-row-act2')?.querySelector('[data-testid="eval-pass"]')?.textContent).toContain(
        '5/5',
      );
      expect(q('eval-row-act2')?.textContent).toContain('100%');
      expect(q('eval-row-act2')?.querySelector('[data-testid="eval-p90"]')?.textContent).toContain(
        '1.5 s',
      );
      expect(
        q('eval-row-act3')?.querySelector('[data-testid="eval-self-correction"]')?.textContent,
      ).toContain('–');
    });

    it('lists failed runs with their reasons and links them to the inspector', async () => {
      const { q, root, layout } = await runEvals(failingAct2);
      expect(q('eval-row-act2')?.querySelector('[data-testid="eval-pass"]')?.textContent).toContain(
        '0/5',
      );
      expect(q('eval-failures-act1')).toBeNull();
      const failures = q('eval-failures-act2');
      expect(failures?.textContent).toContain('5 failed runs');
      expect(failures?.textContent).toContain('Missing setDealFilter');
      root
        .querySelector<HTMLButtonElement>(
          '[data-testid="eval-failures-act2"] [data-testid="eval-inspect"]',
        )
        ?.click();
      expect(layout.inspectorOpen()).toBe(true);
      expect(layout.inspectorRunId()).toMatch(/^run-act2-/);
    });

    it('builds eval-log rows from the change text and offers to copy them', async () => {
      const writeText = vi.fn().mockResolvedValue(undefined);
      vi.stubGlobal('navigator', { clipboard: { writeText } });
      const { fixture, q, click } = await runEvals(passing);
      const change = q<HTMLInputElement>('eval-change');
      if (change) {
        change.value = 'Reworded setDealFilter';
        change.dispatchEvent(new Event('input', { bubbles: true }));
      }
      await fixture.whenStable();
      await click('eval-log-rows');
      const output = q('eval-log-output')?.textContent ?? '';
      expect(output.split('\n')).toHaveLength(4);
      expect(output).toContain('| 2026-11-09 | act2 | Reworded setDealFilter | – → 5/5 | 1.5 s |');
      await click('eval-copy');
      await vi.waitFor(() => expect(q('eval-copy')?.textContent).toContain('Copied'));
      expect(writeText).toHaveBeenCalledWith(output);
    });

    it('does not claim to have copied when the clipboard is unavailable', async () => {
      vi.stubGlobal('navigator', {});
      const { q, click } = await runEvals(passing);
      await click('eval-log-rows');
      await click('eval-copy');
      expect(q('eval-copy')?.textContent).toContain('Copy rows');
    });

    it('exports the results as a JSON file', async () => {
      const createObjectURL = vi.fn().mockReturnValue('blob:evals');
      vi.stubGlobal('URL', { createObjectURL, revokeObjectURL: vi.fn() });
      const click = vi
        .spyOn(HTMLAnchorElement.prototype, 'click')
        .mockImplementation(() => undefined);
      const { click: press } = await runEvals(passing);
      await press('eval-export');
      const json = JSON.parse(await (createObjectURL.mock.calls[0]?.[0] as Blob).text());
      expect(json.runs).toHaveLength(20);
      expect(json.summaries).toHaveLength(4);
      expect(click).toHaveBeenCalledOnce();
    });

    it('clears the table', async () => {
      const { q, click } = await runEvals(passing);
      await click('eval-clear');
      expect(q('eval-table')).toBeNull();
    });

    it('offers Stop while running', async () => {
      let open!: () => void;
      const gate = new Promise<void>((resolve) => (open = resolve));
      const { fixture, q, click } = setup(async (options) => {
        await gate;
        return passing(options);
      });
      await fixture.whenStable();
      await click('eval-run');
      await vi.waitFor(() => expect(q('eval-stop')).not.toBeNull());
      expect(q<HTMLInputElement>('eval-act-act1')?.disabled).toBe(true);
      await click('eval-stop');
      open();
      await vi.waitFor(() => expect(q('eval-run')).not.toBeNull());
    });
  });

  describe('accessibility', () => {
    it('is free of axe violations before any run', async () => {
      const { fixture, root } = setup();
      await fixture.whenStable();
      await expectNoA11yViolations(root);
    });

    it('is free of axe violations without a key', async () => {
      const { fixture, root } = setup(defaultOutcome, { key: false });
      await fixture.whenStable();
      await expectNoA11yViolations(root);
    });

    it('is free of axe violations with eval results', async () => {
      const failing: Handler = (options) =>
        Promise.resolve(
          evalAct(options.prompt) === 'act2'
            ? makeOutcome({ model: options.model, toolCalls: [toolCall('searchDeals')] })
            : passingOutcome(evalAct(options.prompt), { model: options.model }),
        );
      const { fixture, root, click, q } = setup(failing);
      await fixture.whenStable();
      await click('eval-run');
      await vi.waitFor(() => expect(q('eval-progress')?.textContent).toContain('20 of 20 runs'));
      await click('eval-log-rows');
      await fixture.whenStable();
      await expectNoA11yViolations(root);
    });

    it('is free of axe violations in eval mode', async () => {
      const { fixture, root, evalMode } = setup();
      evalMode.set(true);
      await fixture.whenStable();
      await expectNoA11yViolations(root);
    });
  });
});
