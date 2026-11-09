import { TestBed } from '@angular/core/testing';
import { patchState, signalStore, withMethods, withState } from '@ngrx/signals';
import { withStateSnapshot } from './with-state-snapshot';

const Store = signalStore(
  withState({ items: [{ id: 1, tags: ['a'] }], filter: 'all', nested: { count: 1 } }),
  withMethods((store) => ({
    add(tag: string): void {
      patchState(store, (state) => ({
        items: [{ id: 1, tags: [...(state.items[0]?.tags ?? []), tag] }],
        nested: { count: state.nested.count + 1 },
      }));
    },
    setFilter(filter: string): void {
      patchState(store, { filter });
    },
  })),
  withStateSnapshot(),
);

function setup() {
  TestBed.configureTestingModule({ providers: [Store] });
  return TestBed.inject(Store);
}

describe('withStateSnapshot', () => {
  it('captures the full state', () => {
    const store = setup();
    expect(store.snapshotState()).toEqual({
      items: [{ id: 1, tags: ['a'] }],
      filter: 'all',
      nested: { count: 1 },
    });
  });

  it('restores the exact earlier state after changes', () => {
    const store = setup();
    const snapshot = store.snapshotState();
    store.add('b');
    store.setFilter('open');
    store.restoreState(snapshot);
    expect(store.snapshotState()).toEqual(snapshot);
    expect(store.filter()).toBe('all');
  });

  it('returns a copy, so later changes do not leak into the snapshot', () => {
    const store = setup();
    const snapshot = store.snapshotState();
    store.add('b');
    expect(snapshot['items']).toEqual([{ id: 1, tags: ['a'] }]);
  });

  it('restores a copy, so the snapshot can be reused', () => {
    const store = setup();
    const snapshot = store.snapshotState();
    store.restoreState(snapshot);
    store.add('b');
    store.restoreState(snapshot);
    expect(store.items()[0]?.tags).toEqual(['a']);
  });
});
