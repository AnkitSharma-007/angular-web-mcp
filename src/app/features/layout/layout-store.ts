import { patchState, signalStore, withMethods, withState } from '@ngrx/signals';

interface LayoutState {
  consoleOpen: boolean;
  inspectorOpen: boolean;
}

export const LayoutStore = signalStore(
  { providedIn: 'root' },
  withState<LayoutState>({ consoleOpen: false, inspectorOpen: false }),
  withMethods((store) => ({
    toggleConsole(): void {
      patchState(store, (state) => ({ consoleOpen: !state.consoleOpen }));
    },
    openConsole(): void {
      patchState(store, { consoleOpen: true });
    },
    toggleInspector(): void {
      patchState(store, (state) => ({ inspectorOpen: !state.inspectorOpen }));
    },
  })),
);
