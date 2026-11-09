import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { makeOutcome } from '../../../testing/run-outcomes';
import { FakeGenAI, fakeGenAiFactory } from '../../../testing/fake-genai';
import { CLOCK } from '../../core/util/clock';
import { GEMINI_MODELS, estimateCostUsd } from '../../mcp/agent/gemini/gemini-models';
import { GENAI_CLIENT_FACTORY } from '../../mcp/agent/gemini/genai-client';
import { SettingsStore } from '../settings/settings-store';
import { IsolatedRunner, type IsolatedRunOptions, type RunOutcome } from './isolated-run';
import {
  DEFAULT_RACE_MODELS,
  DEFAULT_RACE_PROMPT,
  ModelRaceStore,
  RACE_ESTIMATE_USAGE,
} from './model-race';

type Handler = (options: IsolatedRunOptions) => Promise<RunOutcome>;

const NOW = new Date('2026-11-09T10:00:00Z');

function setup(
  handler: Handler = (options) => Promise.resolve(makeOutcome({ model: options.model })),
  key = true,
) {
  localStorage.clear();
  sessionStorage.clear();
  const release = vi.fn();
  const runner = {
    run: vi.fn(handler),
    beginBatch: vi.fn(() => release),
    evalMode: signal(false),
  };
  TestBed.configureTestingModule({
    providers: [
      ModelRaceStore,
      { provide: IsolatedRunner, useValue: runner },
      { provide: CLOCK, useValue: () => NOW },
      { provide: GENAI_CLIENT_FACTORY, useValue: fakeGenAiFactory(new FakeGenAI()) },
    ],
  });
  if (key) {
    TestBed.inject(SettingsStore).saveKey('AIza-test-key-0001', false);
  }
  return { store: TestBed.inject(ModelRaceStore), runner, release };
}

const ids = (store: InstanceType<typeof ModelRaceStore>) =>
  store.entries().map((entry) => entry.model);

describe('ModelRaceStore', () => {
  afterEach(() => {
    localStorage.clear();
    sessionStorage.clear();
  });

  describe('selection', () => {
    it('selects the Sprinter and the Operator by default and leaves the Strategist out', () => {
      const { store } = setup();
      expect(store.selected()).toEqual(['gemini-3.5-flash-lite', 'gemini-3.8-flash']);
      expect(store.selected()).toEqual([...DEFAULT_RACE_MODELS]);
      expect(store.selectedModels().map((model) => model.persona)).toEqual([
        'Sprinter',
        'Operator',
      ]);
      expect(store.selected()).not.toContain('gemini-4-argon');
    });

    it('adds the Strategist only when it is toggled on, and removes it again', () => {
      const { store } = setup();
      store.toggleModel('gemini-4-argon');
      expect(store.selectedModels().map((model) => model.id)).toContain('gemini-4-argon');
      store.toggleModel('gemini-4-argon');
      expect(store.selectedModels().map((model) => model.id)).not.toContain('gemini-4-argon');
    });

    it('keeps the selected models in catalog order whatever the click order', () => {
      const { store } = setup();
      store.toggleModel('gemini-3.5-flash-lite');
      store.toggleModel('gemini-3.8-flash');
      store.toggleModel('gemini-4-argon');
      store.toggleModel('gemini-3.8-flash');
      store.toggleModel('gemini-3.5-flash-lite');
      expect(store.selectedModels().map((model) => model.id)).toEqual(
        GEMINI_MODELS.map((model) => model.id),
      );
    });
  });

  describe('cost estimate', () => {
    it('prices the selected models for a typical read-only run', () => {
      const { store } = setup();
      const expected =
        (estimateCostUsd('gemini-3.5-flash-lite', RACE_ESTIMATE_USAGE, NOW) ?? 0) +
        (estimateCostUsd('gemini-3.8-flash', RACE_ESTIMATE_USAGE, NOW) ?? 0);
      expect(store.estimatedCostUsd()).toBeCloseTo(expected, 10);
      expect(store.estimatedCostUsd()).toBeGreaterThan(0);
    });

    it('goes up when the Strategist is added and is zero with nothing selected', () => {
      const { store } = setup();
      const before = store.estimatedCostUsd();
      store.toggleModel('gemini-4-argon');
      expect(store.estimatedCostUsd()).toBeGreaterThan(before);
      for (const id of [...store.selected()]) {
        store.toggleModel(id);
      }
      expect(store.estimatedCostUsd()).toBe(0);
    });
  });

  describe('running', () => {
    it('runs only the selected models, in catalog order, one after another', async () => {
      const order: string[] = [];
      const { store, runner } = setup(async (options) => {
        order.push(`start ${options.model}`);
        await Promise.resolve();
        order.push(`end ${options.model}`);
        return makeOutcome({ model: options.model });
      });
      await store.run(DEFAULT_RACE_PROMPT);
      expect(runner.run).toHaveBeenCalledTimes(2);
      expect(order).toEqual([
        'start gemini-3.5-flash-lite',
        'end gemini-3.5-flash-lite',
        'start gemini-3.8-flash',
        'end gemini-3.8-flash',
      ]);
      expect(ids(store)).toEqual(['gemini-3.5-flash-lite', 'gemini-3.8-flash']);
    });

    it('includes the Strategist only after it was selected', async () => {
      const { store, runner } = setup();
      await store.run('p');
      expect(runner.run.mock.calls.map(([options]) => options.model)).not.toContain(
        'gemini-4-argon',
      );
      store.toggleModel('gemini-4-argon');
      await store.run('p');
      expect(runner.run.mock.calls.slice(2).map(([options]) => options.model)).toEqual([
        'gemini-3.5-flash-lite',
        'gemini-3.8-flash',
        'gemini-4-argon',
      ]);
    });

    it('sends the trimmed prompt and an abort signal to every run', async () => {
      const { store, runner } = setup();
      await store.run('  Which deals?  ');
      for (const [options] of runner.run.mock.calls) {
        expect(options.prompt).toBe('Which deals?');
        expect(options.signal).toBeInstanceOf(AbortSignal);
      }
    });

    it('marks each result done and keeps its outcome', async () => {
      const { store } = setup();
      await store.run('p');
      expect(store.entries().map((entry) => entry.status)).toEqual(['done', 'done']);
      expect(store.entries().every((entry) => entry.outcome !== null)).toBe(true);
      expect(store.running()).toBe(false);
    });

    it('shows queued and running states while the race is going', async () => {
      let open!: () => void;
      const gate = new Promise<void>((resolve) => (open = resolve));
      const { store } = setup(async (options) => {
        if (options.model === 'gemini-3.5-flash-lite') {
          await gate;
        }
        return makeOutcome({ model: options.model });
      });
      const race = store.run('p');
      await vi.waitFor(() => expect(store.entries()[0]?.status).toBe('running'));
      expect(store.entries()[1]?.status).toBe('queued');
      expect(store.running()).toBe(true);
      expect(store.canRun()).toBe(false);
      open();
      await race;
    });

    it('does not start a second race while one is running', async () => {
      let open!: () => void;
      const gate = new Promise<void>((resolve) => (open = resolve));
      const { store, runner } = setup(async (options) => {
        await gate;
        return makeOutcome({ model: options.model });
      });
      const first = store.run('p');
      await store.run('p');
      open();
      await first;
      expect(runner.run).toHaveBeenCalledTimes(2);
    });

    it('holds eval mode for the whole race and releases it afterwards', async () => {
      const { store, runner, release } = setup();
      await store.run('p');
      expect(runner.beginBatch).toHaveBeenCalledOnce();
      expect(release).toHaveBeenCalledOnce();
    });
  });

  describe('failures', () => {
    it('keeps racing when one model throws', async () => {
      const { store } = setup(async (options) => {
        if (options.model === 'gemini-3.5-flash-lite') {
          throw new Error('Sprinter fell over');
        }
        return makeOutcome({ model: options.model });
      });
      await store.run('p');
      expect(store.entries().map((entry) => [entry.model, entry.status, entry.error])).toEqual([
        ['gemini-3.5-flash-lite', 'failed', 'Sprinter fell over'],
        ['gemini-3.8-flash', 'done', null],
      ]);
    });

    it('keeps racing when one run ends with an agent error, and keeps its outcome', async () => {
      const { store } = setup(async (options) =>
        makeOutcome({
          model: options.model,
          error:
            options.model === 'gemini-3.5-flash-lite'
              ? { kind: 'quota', message: 'Quota exceeded' }
              : null,
        }),
      );
      await store.run('p');
      const [first, second] = store.entries();
      expect(first).toMatchObject({ status: 'failed', error: 'Quota exceeded' });
      expect(first?.outcome).not.toBeNull();
      expect(second?.status).toBe('done');
    });

    it('describes a non-Error rejection', async () => {
      const { store } = setup(() => Promise.reject('plain'));
      await store.run('p');
      expect(store.entries().map((entry) => entry.error)).toEqual(['plain', 'plain']);
    });

    it('releases eval mode and unlocks even when every model fails', async () => {
      const { store, release } = setup(() => Promise.reject(new Error('down')));
      await store.run('p');
      expect(release).toHaveBeenCalledOnce();
      expect(store.running()).toBe(false);
      expect(store.canRun()).toBe(true);
    });
  });

  describe('stop', () => {
    it('aborts the run in flight and marks the models that never started', async () => {
      const { store, runner } = setup(async (options) => {
        options.signal?.throwIfAborted();
        return makeOutcome({ model: options.model, stopped: options.signal?.aborted ?? false });
      });
      runner.run.mockImplementationOnce(async (options) => {
        store.stop();
        return makeOutcome({ model: options.model, stopped: true });
      });
      await store.run('p');
      expect(store.entries().map((entry) => [entry.status, entry.error])).toEqual([
        ['failed', 'Stopped'],
        ['failed', 'Stopped'],
      ]);
      expect(runner.run).toHaveBeenCalledOnce();
    });

    it('does nothing when no race is running', () => {
      const { store } = setup();
      expect(() => store.stop()).not.toThrow();
    });
  });

  describe('Run button state', () => {
    it('is disabled with an empty selection', () => {
      const { store } = setup();
      store.toggleModel('gemini-3.5-flash-lite');
      store.toggleModel('gemini-3.8-flash');
      expect(store.canRun()).toBe(false);
    });

    it('is disabled without a key and enabled with one', () => {
      expect(setup(undefined, false).store.canRun()).toBe(false);
    });

    it('is enabled with the defaults and a key', () => {
      expect(setup().store.canRun()).toBe(true);
    });

    it('ignores run() when it is disabled or the prompt is blank', async () => {
      const { store, runner } = setup();
      await store.run('   ');
      store.toggleModel('gemini-3.5-flash-lite');
      store.toggleModel('gemini-3.8-flash');
      await store.run('p');
      expect(runner.run).not.toHaveBeenCalled();
      expect(store.entries()).toEqual([]);
    });
  });
});
