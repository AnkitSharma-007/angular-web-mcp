import {
  getState,
  patchState,
  signalStoreFeature,
  withMethods,
  type WritableStateSource,
} from '@ngrx/signals';

export type StateSnapshot = Record<string, unknown>;

/** Adds a deep copy of the whole state and its exact restore, history included. */
export function withStateSnapshot() {
  return signalStoreFeature(
    withMethods((store) => ({
      snapshotState(): StateSnapshot {
        return structuredClone(getState(store)) as StateSnapshot;
      },
      restoreState(snapshot: StateSnapshot): void {
        patchState(store as WritableStateSource<object>, structuredClone(snapshot));
      },
    })),
  );
}
