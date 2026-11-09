import { computed, inject } from '@angular/core';
import {
  getState,
  patchState,
  signalStoreFeature,
  withComputed,
  withMethods,
  withState,
  type WritableStateSource,
} from '@ngrx/signals';
import { CLOCK } from '../util/clock';

export interface HistoryEntry {
  id: string;
  label: string;
  at: string;
  snapshot: Record<string, unknown>;
}

export interface AgentHistoryState {
  history: HistoryEntry[];
}

export interface AgentHistoryOptions {
  capacity: number;
}

/** Adds a bounded snapshot history and human-only undo to any SignalStore. */
export function withAgentHistory(options: AgentHistoryOptions) {
  return signalStoreFeature(
    withState<AgentHistoryState>({ history: [] }),
    withComputed(({ history }) => ({
      canUndo: computed(() => history().length > 0),
      lastEntry: computed(() => history().at(-1) ?? null),
    })),
    withMethods((store) => {
      const clock = inject(CLOCK);
      let sequence = 0;

      const restore = (snapshot: Record<string, unknown>) =>
        patchState(store as WritableStateSource<object>, structuredClone(snapshot));

      return {
        recordSnapshot(label: string): string {
          const { history, ...rest } = getState(store) as AgentHistoryState &
            Record<string, unknown>;
          const entry: HistoryEntry = {
            id: `h-${++sequence}`,
            label,
            at: clock().toISOString(),
            snapshot: structuredClone(rest),
          };
          patchState(store, { history: [...history, entry].slice(-options.capacity) });
          return entry.id;
        },
        undo(): HistoryEntry | null {
          const entry = store.history().at(-1);
          if (!entry) {
            return null;
          }
          restore(entry.snapshot);
          patchState(store, { history: store.history().slice(0, -1) });
          return entry;
        },
        undoTo(id: string): HistoryEntry | null {
          const index = store.history().findIndex((entry) => entry.id === id);
          const entry = store.history()[index];
          if (!entry) {
            return null;
          }
          restore(entry.snapshot);
          patchState(store, { history: store.history().slice(0, index) });
          return entry;
        },
        clearHistory(): void {
          patchState(store, { history: [] });
        },
      };
    }),
  );
}
