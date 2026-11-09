import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { FakeGenAI, fakeGenAiFactory } from '../../../testing/fake-genai';
import { makeOutcome, passingOutcome, toolCall } from '../../../testing/run-outcomes';
import { CLOCK } from '../../core/util/clock';
import { GENAI_CLIENT_FACTORY } from '../../mcp/agent/gemini/genai-client';
import { SettingsStore } from '../settings/settings-store';
import { ACT_EVALS } from './act-evals';
import { EvalSessionStore } from './eval-session';
import { IsolatedRunner, type IsolatedRunOptions, type RunOutcome } from './isolated-run';

type Handler = (options: IsolatedRunOptions, call: number) => Promise<RunOutcome>;

const NOW = new Date('2026-11-09T10:00:00Z');

function actOf(options: IsolatedRunOptions) {
  const spec = ACT_EVALS.find((candidate) => candidate.prompts.includes(options.prompt));
  if (!spec) {
    throw new Error(`no act for prompt: ${options.prompt}`);
  }
  return spec;
}

const passing: Handler = (options) =>
  Promise.resolve(passingOutcome(actOf(options).id, { model: options.model }));

function setup(handler: Handler = passing, key = true) {
  localStorage.clear();
  sessionStorage.clear();
  const release = vi.fn();
  let call = 0;
  const runner = {
    run: vi.fn((options: IsolatedRunOptions) => handler(options, call++)),
    beginBatch: vi.fn(() => release),
    evalMode: signal(false),
  };
  TestBed.configureTestingModule({
    providers: [
      EvalSessionStore,
      { provide: IsolatedRunner, useValue: runner },
      { provide: CLOCK, useValue: () => NOW },
      { provide: GENAI_CLIENT_FACTORY, useValue: fakeGenAiFactory(new FakeGenAI()) },
    ],
  });
  if (key) {
    TestBed.inject(SettingsStore).saveKey('AIza-test-key-0001', false);
  }
  return { store: TestBed.inject(EvalSessionStore), runner, release };
}

describe('EvalSessionStore', () => {
  afterEach(() => {
    localStorage.clear();
    sessionStorage.clear();
  });

  describe('configuration', () => {
    it('selects every act with 5 runs by default', () => {
      const { store } = setup();
      expect(store.selectedActs()).toEqual(['act1', 'act2', 'act3', 'act4']);
      expect(store.runsPerAct()).toBe(5);
      expect(store.rows()).toEqual([]);
    });

    it('toggles acts and the number of runs', () => {
      const { store } = setup();
      store.toggleAct('act3');
      expect(store.selectedActs()).toEqual(['act1', 'act2', 'act4']);
      store.toggleAct('act3');
      expect(store.selectedActs()).toContain('act3');
      store.setRunsPerAct(10);
      expect(store.runsPerAct()).toBe(10);
    });

    it('scales the cost estimate with runs and acts', () => {
      const { store } = setup();
      const five = store.estimatedCostUsd();
      store.setRunsPerAct(10);
      expect(store.estimatedCostUsd()).toBeCloseTo(five * 2, 10);
      store.toggleAct('act1');
      store.toggleAct('act2');
      store.toggleAct('act3');
      store.toggleAct('act4');
      expect(store.estimatedCostUsd()).toBe(0);
    });

    it('cannot run without a key', () => {
      expect(setup(passing, false).store.canRun()).toBe(false);
    });

    it('cannot run without an act', () => {
      const { store } = setup();
      expect(store.canRun()).toBe(true);
      for (const id of [...store.selectedActs()]) {
        store.toggleAct(id);
      }
      expect(store.canRun()).toBe(false);
    });
  });

  describe('running', () => {
    it('runs the chosen number of prompts per act on that act’s model', async () => {
      const { store, runner } = setup();
      await store.run();
      expect(runner.run).toHaveBeenCalledTimes(20);
      const perAct = (id: string) =>
        runner.run.mock.calls.filter(([options]) => actOf(options).id === id);
      for (const spec of ACT_EVALS) {
        expect(perAct(spec.id)).toHaveLength(5);
        expect(perAct(spec.id).every(([options]) => options.model === spec.model)).toBe(true);
      }
    });

    it('runs 10 per act when asked and only for the selected acts', async () => {
      const { store, runner } = setup();
      store.setRunsPerAct(10);
      store.toggleAct('act1');
      store.toggleAct('act2');
      store.toggleAct('act3');
      await store.run();
      expect(runner.run).toHaveBeenCalledTimes(10);
      expect(store.rows().map((row) => row.summary.actId)).toEqual(['act4']);
    });

    it('cycles through the stage prompt and its paraphrases', async () => {
      const { store, runner } = setup();
      store.setRunsPerAct(5);
      store.toggleAct('act1');
      store.toggleAct('act3');
      store.toggleAct('act4');
      await store.run();
      const act2 = ACT_EVALS.find((spec) => spec.id === 'act2');
      const used = runner.run.mock.calls.map(([options]) => options.prompt);
      expect(used).toEqual(
        Array.from({ length: 5 }, (_, i) => act2?.prompts[i % act2.prompts.length]),
      );
      expect(used[0]).toBe(act2?.prompts[0]);
    });

    it('starts every eval run from the seed state', async () => {
      const { store, runner } = setup();
      await store.run();
      expect(runner.run.mock.calls.every(([options]) => options.fromSeed === true)).toBe(true);
    });

    it('passes the scripted approvals for the governance act only', async () => {
      const { store, runner } = setup();
      await store.run();
      for (const [options] of runner.run.mock.calls) {
        if (actOf(options).id === 'act4') {
          expect(options.approvals).toEqual(['approve', 'reject']);
        } else {
          expect(options.approvals).toBeUndefined();
        }
      }
    });

    it('scores each run and summarizes by act in catalog order', async () => {
      const { store } = setup();
      await store.run();
      expect(store.runs()).toHaveLength(20);
      expect(store.rows().map((row) => row.label)).toEqual(ACT_EVALS.map((spec) => spec.label));
      for (const row of store.rows()) {
        expect(row.summary).toMatchObject({ runs: 5, passes: 5, passRate: 1 });
        expect(row.failures).toEqual([]);
      }
    });

    it('lists failing runs with their reasons and run ids for the inspector', async () => {
      const { store } = setup(async (options, call) => {
        const outcome = passingOutcome(actOf(options).id, {
          runId: `r-${call}`,
          model: options.model,
        });
        return actOf(options).id === 'act2' && call % 2 === 0
          ? { ...outcome, toolCalls: [toolCall('searchDeals')] }
          : outcome;
      });
      store.toggleAct('act1');
      store.toggleAct('act3');
      store.toggleAct('act4');
      await store.run();
      const [row] = store.rows();
      expect(row?.summary).toMatchObject({ passes: 2, runs: 5 });
      expect(row?.failures.map((failed) => failed.runId)).toEqual(['r-0', 'r-2', 'r-4']);
      expect(row?.failures[0]?.failures[0]).toContain('Missing setDealFilter');
    });

    it('reports progress while running', async () => {
      let open!: () => void;
      const gate = new Promise<void>((resolve) => (open = resolve));
      const { store } = setup(async (options, call) => {
        if (call === 1) {
          await gate;
        }
        return passing(options, call);
      });
      store.toggleAct('act2');
      store.toggleAct('act3');
      store.toggleAct('act4');
      const run = store.run();
      await vi.waitFor(() => expect(store.progress()).toEqual({ done: 1, total: 5 }));
      expect(store.running()).toBe(true);
      expect(store.canRun()).toBe(false);
      open();
      await run;
      expect(store.progress()).toEqual({ done: 5, total: 5 });
      expect(store.running()).toBe(false);
    });

    it('holds eval mode for the whole series', async () => {
      const { store, runner, release } = setup();
      await store.run();
      expect(runner.beginBatch).toHaveBeenCalledOnce();
      expect(release).toHaveBeenCalledOnce();
    });

    it('ignores run() when it cannot run', async () => {
      const { store, runner } = setup(passing, false);
      await store.run();
      expect(runner.run).not.toHaveBeenCalled();
    });
  });

  describe('re-runs', () => {
    it('replaces an act’s earlier runs and remembers its earlier result', async () => {
      let failing = true;
      const { store } = setup(async (options, call) => {
        const outcome = passingOutcome(actOf(options).id, { model: options.model });
        return failing && call < 2 ? { ...outcome, toolCalls: [] } : outcome;
      });
      store.toggleAct('act1');
      store.toggleAct('act3');
      store.toggleAct('act4');
      await store.run();
      expect(store.rows()[0]?.summary.passes).toBe(3);
      expect(store.rows()[0]?.before).toBeNull();

      failing = false;
      await store.run();
      expect(store.runs()).toHaveLength(5);
      expect(store.rows()[0]?.summary.passes).toBe(5);
      expect(store.rows()[0]?.before).toBe('3/5');
    });

    it('keeps the results of acts that are not re-run', async () => {
      const { store } = setup();
      await store.run();
      store.toggleAct('act1');
      store.toggleAct('act2');
      store.toggleAct('act3');
      await store.run();
      expect(store.runs()).toHaveLength(20);
      expect(store.rows().find((row) => row.summary.actId === 'act1')?.before).toBeNull();
    });

    it('clears everything', async () => {
      const { store } = setup();
      await store.run();
      store.clear();
      expect(store.runs()).toEqual([]);
      expect(store.rows()).toEqual([]);
      expect(store.progress()).toEqual({ done: 0, total: 0 });
    });
  });

  describe('failures and stopping', () => {
    it('records a run that throws as a failed run and carries on', async () => {
      const { store } = setup(async (options, call) => {
        if (call === 0) {
          throw new Error('socket closed');
        }
        return passing(options, call);
      });
      store.toggleAct('act2');
      store.toggleAct('act3');
      store.toggleAct('act4');
      await store.run();
      const failed = store.runs()[0];
      expect(failed?.passed).toBe(false);
      expect(failed?.failures).toEqual(['Run error (unknown): socket closed']);
      expect(failed?.runId).toBe('act1-1');
      expect(store.runs()).toHaveLength(5);
    });

    it('describes a non-Error rejection', async () => {
      const { store } = setup(() => Promise.reject('plain'));
      store.setRunsPerAct(5);
      store.toggleAct('act2');
      store.toggleAct('act3');
      store.toggleAct('act4');
      await store.run();
      expect(store.runs()[0]?.failures).toEqual(['Run error (unknown): plain']);
    });

    it.each(['auth', 'model-access'] as const)(
      'stops the whole series after a %s error',
      async (kind) => {
        const { store, runner } = setup(async (options) =>
          makeOutcome({ model: options.model, error: { kind, message: 'nope' } }),
        );
        await store.run();
        expect(runner.run).toHaveBeenCalledOnce();
        expect(store.runs()).toHaveLength(1);
        expect(store.running()).toBe(false);
      },
    );

    it('keeps going after a quota error', async () => {
      const { store, runner } = setup(async (options) =>
        makeOutcome({ model: options.model, error: { kind: 'quota', message: 'slow down' } }),
      );
      store.toggleAct('act2');
      store.toggleAct('act3');
      store.toggleAct('act4');
      await store.run();
      expect(runner.run).toHaveBeenCalledTimes(5);
    });

    it('stops after the run in flight and drops its result', async () => {
      const { store, runner } = setup(async (options, call) => {
        if (call === 2) {
          store.stop();
        }
        return passing(options, call);
      });
      await store.run();
      expect(runner.run).toHaveBeenCalledTimes(3);
      expect(store.runs()).toHaveLength(2);
      expect(store.running()).toBe(false);
    });

    it('passes one abort signal to every run', async () => {
      const { store, runner } = setup();
      store.toggleAct('act2');
      store.toggleAct('act3');
      store.toggleAct('act4');
      await store.run();
      const signals = new Set(runner.run.mock.calls.map(([options]) => options.signal));
      expect(signals.size).toBe(1);
    });

    it('does nothing on stop when idle', () => {
      const { store } = setup();
      expect(() => store.stop()).not.toThrow();
    });
  });

  describe('export', () => {
    it('exports summaries and runs as JSON', async () => {
      const { store } = setup();
      store.toggleAct('act2');
      store.toggleAct('act3');
      store.toggleAct('act4');
      await store.run();
      const json = JSON.parse(store.exportJson());
      expect(json.exportedAt).toBe(NOW.toISOString());
      expect(json.summaries).toHaveLength(1);
      expect(json.runs).toHaveLength(5);
    });

    it('builds one log row per act with the date, change, before and p90', async () => {
      const { store } = setup();
      store.toggleAct('act3');
      store.toggleAct('act4');
      await store.run();
      await store.run();
      const rows = store.logRows('Reworded the filter description');
      expect(rows).toHaveLength(2);
      expect(rows[0]).toBe(
        '| 2026-11-09 | act1 | Reworded the filter description | 5/5 → 5/5 | 1.5 s |',
      );
    });

    it('uses baseline and no previous result on a first run', async () => {
      const { store } = setup();
      store.toggleAct('act2');
      store.toggleAct('act3');
      store.toggleAct('act4');
      await store.run();
      expect(store.logRows('')).toEqual(['| 2026-11-09 | act1 | baseline | – → 5/5 | 1.5 s |']);
    });
  });
});
