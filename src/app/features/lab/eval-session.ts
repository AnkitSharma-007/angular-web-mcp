import { computed, inject } from '@angular/core';
import {
  patchState,
  signalStore,
  withComputed,
  withMethods,
  withProps,
  withState,
} from '@ngrx/signals';
import { CLOCK } from '../../core/util/clock';
import { estimateCostUsd } from '../../mcp/agent/gemini/gemini-models';
import type { ActId } from '../agent-console/demo-prompts';
import { SettingsStore } from '../settings/settings-store';
import {
  ACT_EVALS,
  exportEvalJson,
  failedEvalRun,
  summarize,
  toEvalLogRow,
  toEvalRun,
  type ActSummary,
  type EvalRun,
} from './act-evals';
import { IsolatedRunner } from './isolated-run';
import { RACE_ESTIMATE_USAGE } from './model-race';

export type RunsPerAct = 5 | 10;

export const RUNS_PER_ACT_OPTIONS: readonly RunsPerAct[] = [5, 10];

const FATAL_KINDS = new Set(['auth', 'model-access']);

interface EvalState {
  selectedActs: ActId[];
  runsPerAct: RunsPerAct;
  runs: EvalRun[];
  before: Partial<Record<ActId, string>>;
  running: boolean;
  progress: { done: number; total: number };
}

export interface EvalRow {
  summary: ActSummary;
  label: string;
  before: string | null;
  failures: EvalRun[];
}

export const EvalSessionStore = signalStore(
  withState<EvalState>({
    selectedActs: ACT_EVALS.map((spec) => spec.id),
    runsPerAct: 5,
    runs: [],
    before: {},
    running: false,
    progress: { done: 0, total: 0 },
  }),
  withProps(() => ({
    _runner: inject(IsolatedRunner),
    _settings: inject(SettingsStore),
    _clock: inject(CLOCK),
    _control: { controller: null as AbortController | null },
  })),
  withComputed(({ runs, before, selectedActs, runsPerAct, running, _settings, _clock }) => ({
    rows: computed<EvalRow[]>(() =>
      ACT_EVALS.filter((spec) => runs().some((run) => run.actId === spec.id)).map((spec) => {
        const own = runs().filter((run) => run.actId === spec.id);
        return {
          summary: summarize(spec.id, own),
          label: spec.label,
          before: before()[spec.id] ?? null,
          failures: own.filter((run) => !run.passed),
        };
      }),
    ),
    estimatedCostUsd: computed(() => {
      const at = _clock();
      return ACT_EVALS.filter((spec) => selectedActs().includes(spec.id)).reduce(
        (sum, spec) =>
          sum + runsPerAct() * (estimateCostUsd(spec.model, RACE_ESTIMATE_USAGE, at) ?? 0),
        0,
      );
    }),
    canRun: computed(() => !running() && selectedActs().length > 0 && _settings.canUseAgent()),
  })),
  withMethods((store) => {
    const dateOf = (): string => store._clock().toISOString().slice(0, 10);

    return {
      toggleAct(id: ActId): void {
        patchState(store, (state) => ({
          selectedActs: state.selectedActs.includes(id)
            ? state.selectedActs.filter((entry) => entry !== id)
            : [...state.selectedActs, id],
        }));
      },
      setRunsPerAct(runsPerAct: RunsPerAct): void {
        patchState(store, { runsPerAct });
      },
      async run(): Promise<void> {
        if (!store.canRun()) {
          return;
        }
        const specs = ACT_EVALS.filter((spec) => store.selectedActs().includes(spec.id));
        const count = store.runsPerAct();
        const controller = new AbortController();
        store._control.controller = controller;

        const previous = Object.fromEntries(
          store
            .rows()
            .filter((row) => specs.some((spec) => spec.id === row.summary.actId))
            .map((row) => [row.summary.actId, `${row.summary.passes}/${row.summary.runs}`]),
        );
        patchState(store, (state) => ({
          running: true,
          before: { ...state.before, ...previous },
          runs: state.runs.filter((run) => !specs.some((spec) => spec.id === run.actId)),
          progress: { done: 0, total: specs.length * count },
        }));

        const release = store._runner.beginBatch();
        try {
          series: for (const spec of specs) {
            for (let index = 0; index < count; index++) {
              if (controller.signal.aborted) {
                break series;
              }
              const prompt = spec.prompts[index % spec.prompts.length] ?? spec.prompts[0] ?? '';
              let evalRun: EvalRun;
              let fatal = false;
              try {
                const outcome = await store._runner.run({
                  prompt,
                  model: spec.model,
                  fromSeed: true,
                  ...(spec.approvals !== undefined && { approvals: spec.approvals }),
                  signal: controller.signal,
                });
                evalRun = toEvalRun(spec, outcome, index);
                fatal = outcome.error !== null && FATAL_KINDS.has(outcome.error.kind);
              } catch (error) {
                evalRun = failedEvalRun(
                  spec,
                  index,
                  prompt,
                  `${spec.id}-${index + 1}`,
                  error instanceof Error ? error.message : String(error),
                );
              }
              if (controller.signal.aborted) {
                break series;
              }
              patchState(store, (state) => ({
                runs: [...state.runs, evalRun],
                progress: { ...state.progress, done: state.progress.done + 1 },
              }));
              if (fatal) {
                break series;
              }
            }
          }
        } finally {
          release();
          store._control.controller = null;
          patchState(store, { running: false });
        }
      },
      stop(): void {
        store._control.controller?.abort();
      },
      clear(): void {
        patchState(store, { runs: [], before: {}, progress: { done: 0, total: 0 } });
      },
      exportJson(): string {
        return exportEvalJson(
          store.rows().map((row) => row.summary),
          store.runs(),
          store._clock(),
        );
      },
      logRows(change: string): string[] {
        return store.rows().map((row) =>
          toEvalLogRow(row.summary, {
            date: dateOf(),
            change,
            ...(row.before !== null && { before: row.before }),
          }),
        );
      },
    };
  }),
);
