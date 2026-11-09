import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { expectNoA11yViolations } from '../../../testing/a11y';
import { FakeApiError, FakeGenAI, fakeGenAiFactory } from '../../../testing/fake-genai';
import { makeOutcome, passingOutcome, toolCall } from '../../../testing/run-outcomes';
import { CLOCK } from '../../core/util/clock';
import { GENAI_CLIENT_FACTORY } from '../../mcp/agent/gemini/genai-client';
import { LayoutStore } from '../layout/layout-store';
import { ApiKeyDialogLauncher } from '../settings/api-key-dialog-launcher';
import { SettingsStore } from '../settings/settings-store';
import { ACT_EVALS } from './act-evals';
import { IsolatedRunner, type IsolatedRunOptions, type RunOutcome } from './isolated-run';
import { LabPage } from './lab-page';

type Handler = (options: IsolatedRunOptions) => Promise<RunOutcome>;

const NOW = new Date('2026-11-09T10:00:00Z');

const raceOutcome: Handler = (options) =>
  Promise.resolve(
    makeOutcome({
      runId: `race-${options.model}`,
      model: options.model,
      text: `Answer from ${options.model}`,
      ms: options.model === 'gemini-3.5-flash-lite' ? 1200 : 3400,
      toolCalls: [toolCall('getPipelineSummary'), toolCall('searchDeals')],
      usage: { input: 5000, output: 400, thinking: 700 },
      costUsd: 0.0123,
    }),
  );

function setup(
  handler: Handler = raceOutcome,
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

  describe('model race', () => {
    it('offers the Sprinter and the Operator selected, and the Strategist with a paid badge', async () => {
      const { fixture, q, root } = setup();
      await fixture.whenStable();
      expect(q<HTMLInputElement>('race-model-gemini-3.5-flash-lite')?.checked).toBe(true);
      expect(q<HTMLInputElement>('race-model-gemini-3.8-flash')?.checked).toBe(true);
      expect(q<HTMLInputElement>('race-model-gemini-4-argon')?.checked).toBe(false);
      expect(root.querySelectorAll('[data-testid="paid-badge"]')).toHaveLength(1);
      expect(q('race-model-gemini-4-argon')?.closest('label')?.textContent).toContain(
        '$2 / $10 per 1M',
      );
    });

    it('shows a pre-run cost estimate that follows the selection', async () => {
      const { fixture, q, click } = setup();
      await fixture.whenStable();
      const two = q('race-estimate')?.textContent ?? '';
      expect(two).toMatch(/≈ \$0\.\d{3} for\s+2 models/);
      await click('race-model-gemini-4-argon');
      expect(q('race-estimate')?.textContent).toContain('3 models');
      expect(q('race-estimate')?.textContent).not.toBe(two);
    });

    it('races the selected models and shows one card each, in catalog order', async () => {
      const { fixture, q, click, root, runner } = setup();
      await fixture.whenStable();
      await click('race-run');
      await vi.waitFor(() => expect(root.querySelectorAll('[data-status="done"]')).toHaveLength(2));
      const cards = [...root.querySelectorAll('[data-testid^="race-card-"]')];
      expect(cards.map((card) => card.getAttribute('data-testid'))).toEqual([
        'race-card-gemini-3.5-flash-lite',
        'race-card-gemini-3.8-flash',
      ]);
      const sprinter = q('race-card-gemini-3.5-flash-lite');
      expect(sprinter?.textContent).toContain('Sprinter');
      expect(sprinter?.querySelector('[data-testid="race-ms"]')?.textContent).toContain('1.2 s');
      expect(sprinter?.querySelector('[data-testid="race-calls"]')?.textContent).toContain('2');
      expect(sprinter?.querySelector('[data-testid="race-thinking"]')?.textContent).toContain(
        '700',
      );
      expect(sprinter?.querySelector('[data-testid="race-cost"]')?.textContent).toContain(
        '$0.0123',
      );
      expect(sprinter?.querySelector('[data-testid="race-answer"]')?.textContent).toContain(
        'Answer from gemini-3.5-flash-lite',
      );
      expect(runner.run.mock.calls[0]?.[0].prompt).toBe(
        'Which three deals should I prioritise this week and why?',
      );
    });

    it('adds the Strategist card only after it was opted in', async () => {
      const { fixture, q, click, root } = setup();
      await fixture.whenStable();
      await click('race-model-gemini-4-argon');
      await click('race-run');
      await vi.waitFor(() => expect(root.querySelectorAll('[data-status="done"]')).toHaveLength(3));
      expect(q('race-card-gemini-4-argon')).not.toBeNull();
    });

    it('lets one model fail without hiding the others', async () => {
      const { fixture, q, click, root } = setup(async (options) => {
        if (options.model === 'gemini-3.5-flash-lite') {
          throw new Error('Sprinter timed out');
        }
        return raceOutcome(options);
      });
      await fixture.whenStable();
      await click('race-run');
      await vi.waitFor(() => expect(root.querySelector('[data-status="done"]')).not.toBeNull());
      expect(q('race-card-gemini-3.5-flash-lite')?.getAttribute('data-status')).toBe('failed');
      expect(
        q('race-card-gemini-3.5-flash-lite')?.querySelector('[role="alert"]')?.textContent,
      ).toContain('Sprinter timed out');
      expect(q('race-card-gemini-3.8-flash')?.getAttribute('data-status')).toBe('done');
    });

    it('opens the packets of a card in the inspector', async () => {
      const { fixture, click, root, layout } = setup();
      await fixture.whenStable();
      await click('race-run');
      await vi.waitFor(() => expect(root.querySelectorAll('[data-status="done"]')).toHaveLength(2));
      root
        .querySelector<HTMLButtonElement>(
          '[aria-label="Open packets for Operator in the inspector"]',
        )
        ?.click();
      expect(layout.inspectorOpen()).toBe(true);
      expect(layout.inspectorRunId()).toBe('race-gemini-3.8-flash');
    });

    it('disables Run when no model is selected', async () => {
      const { fixture, q, click } = setup();
      await fixture.whenStable();
      await click('race-model-gemini-3.5-flash-lite');
      await click('race-model-gemini-3.8-flash');
      expect(q<HTMLButtonElement>('race-run')?.disabled).toBe(true);
      expect(q('race-estimate')?.textContent).toContain('0 models');
    });

    it('disables Run when the prompt is empty', async () => {
      const { fixture, q } = setup();
      await fixture.whenStable();
      const prompt = q<HTMLTextAreaElement>('race-prompt');
      if (prompt) {
        prompt.value = '   ';
        prompt.dispatchEvent(new Event('input', { bubbles: true }));
      }
      await fixture.whenStable();
      expect(q<HTMLButtonElement>('race-run')?.disabled).toBe(true);
    });

    it('offers Stop while racing and Run again afterwards', async () => {
      let open!: () => void;
      const gate = new Promise<void>((resolve) => (open = resolve));
      const { fixture, q, click, runner } = setup(async (options) => {
        await gate;
        return raceOutcome(options);
      });
      await fixture.whenStable();
      await click('race-run');
      await vi.waitFor(() => expect(q('race-stop')).not.toBeNull());
      expect(q('race-run')).toBeNull();
      expect(q<HTMLInputElement>('race-model-gemini-4-argon')?.disabled).toBe(true);
      open();
      await vi.waitFor(() => expect(q('race-run')).not.toBeNull());
      expect(runner.run).toHaveBeenCalledTimes(2);
    });
  });

  describe('without a valid key', () => {
    it('disables Run everywhere and explains why', async () => {
      const { fixture, q } = setup(raceOutcome, { key: false });
      await fixture.whenStable();
      expect(q('key-required')?.textContent).toContain('Add your Gemini API key');
      expect(q<HTMLButtonElement>('race-run')?.disabled).toBe(true);
      expect(q<HTMLButtonElement>('eval-run')?.disabled).toBe(true);
    });

    it('opens the key dialog from the notice', async () => {
      const { fixture, click, open } = setup(raceOutcome, { key: false });
      await fixture.whenStable();
      await click('add-key');
      expect(open).toHaveBeenCalledOnce();
    });

    it('says so when Google rejected the key', async () => {
      const { fixture, q, settings } = setup(raceOutcome, {
        listError: new FakeApiError(401, 'bad'),
      });
      await vi.waitFor(() => {
        TestBed.tick();
        expect(settings.keyStatus()).toBe('invalid');
      });
      await fixture.whenStable();
      expect(q('key-required')?.textContent).toContain('rejected');
      expect(q('add-key')?.textContent).toContain('Replace API key');
      expect(q<HTMLButtonElement>('race-run')?.disabled).toBe(true);
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
      const { fixture, root } = setup(raceOutcome, { key: false });
      await fixture.whenStable();
      await expectNoA11yViolations(root);
    });

    it('is free of axe violations with race and eval results', async () => {
      const failing: Handler = (options) =>
        Promise.resolve(
          evalAct(options.prompt) === 'act2'
            ? makeOutcome({ model: options.model, toolCalls: [toolCall('searchDeals')] })
            : passingOutcome(evalAct(options.prompt), { model: options.model }),
        );
      const { fixture, root, click, q } = setup(failing);
      await fixture.whenStable();
      await click('race-run');
      await click('eval-run');
      await vi.waitFor(() => expect(q('eval-progress')?.textContent).toContain('20 of 20 runs'));
      await vi.waitFor(() => expect(root.querySelectorAll('[data-status="done"]')).toHaveLength(2));
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
