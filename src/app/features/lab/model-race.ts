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
import {
  GEMINI_MODELS,
  estimateCostUsd,
  type GeminiModel,
  type GeminiModelId,
} from '../../mcp/agent/gemini/gemini-models';
import type { TokenUsage } from '../../mcp/telemetry/wire-packet';
import { SettingsStore } from '../settings/settings-store';
import { IsolatedRunner, type RunOutcome } from './isolated-run';

export const DEFAULT_RACE_MODELS: readonly GeminiModelId[] = [
  'gemini-3.5-flash-lite',
  'gemini-3.8-flash',
];
export const DEFAULT_RACE_PROMPT = 'Which three deals should I prioritise this week and why?';
export const RACE_ESTIMATE_USAGE: TokenUsage = { input: 9000, output: 800, thinking: 1500 };

export type RaceStatus = 'queued' | 'running' | 'done' | 'failed';

export interface RaceEntry {
  model: GeminiModelId;
  status: RaceStatus;
  outcome: RunOutcome | null;
  error: string | null;
}

interface RaceState {
  selected: GeminiModelId[];
  entries: RaceEntry[];
  running: boolean;
}

function entryFor(model: GeminiModelId, status: RaceStatus): RaceEntry {
  return { model, status, outcome: null, error: null };
}

export const ModelRaceStore = signalStore(
  withState<RaceState>({
    selected: [...DEFAULT_RACE_MODELS],
    entries: [],
    running: false,
  }),
  withProps(() => ({
    _runner: inject(IsolatedRunner),
    _settings: inject(SettingsStore),
    _clock: inject(CLOCK),
    _control: { controller: null as AbortController | null },
  })),
  withComputed(({ selected, running, _settings, _clock }) => ({
    selectedModels: computed<GeminiModel[]>(() =>
      GEMINI_MODELS.filter((model) => selected().includes(model.id)),
    ),
    estimatedCostUsd: computed(() => {
      const at = _clock();
      return GEMINI_MODELS.filter((model) => selected().includes(model.id)).reduce(
        (sum, model) => sum + (estimateCostUsd(model.id, RACE_ESTIMATE_USAGE, at) ?? 0),
        0,
      );
    }),
    canRun: computed(() => !running() && selected().length > 0 && _settings.canUseAgent()),
  })),
  withMethods((store) => {
    const update = (model: GeminiModelId, changes: Partial<RaceEntry>): void =>
      patchState(store, (state) => ({
        entries: state.entries.map((entry) =>
          entry.model === model ? { ...entry, ...changes } : entry,
        ),
      }));

    return {
      toggleModel(model: GeminiModelId): void {
        patchState(store, (state) => ({
          selected: state.selected.includes(model)
            ? state.selected.filter((id) => id !== model)
            : [...state.selected, model],
        }));
      },
      async run(rawPrompt: string): Promise<void> {
        const prompt = rawPrompt.trim();
        if (!store.canRun() || prompt === '') {
          return;
        }
        const models = store.selectedModels().map((model) => model.id);
        const controller = new AbortController();
        store._control.controller = controller;
        patchState(store, {
          running: true,
          entries: models.map((model) => entryFor(model, 'queued')),
        });
        const release = store._runner.beginBatch();
        try {
          for (const model of models) {
            if (controller.signal.aborted) {
              update(model, { status: 'failed', error: 'Stopped' });
              continue;
            }
            update(model, { status: 'running' });
            try {
              const outcome = await store._runner.run({
                prompt,
                model,
                signal: controller.signal,
              });
              update(model, {
                outcome,
                status: outcome.error || outcome.stopped ? 'failed' : 'done',
                error: outcome.error?.message ?? (outcome.stopped ? 'Stopped' : null),
              });
            } catch (error) {
              update(model, {
                status: 'failed',
                error: error instanceof Error ? error.message : String(error),
              });
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
    };
  }),
);
