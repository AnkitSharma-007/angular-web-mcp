import { TestBed } from '@angular/core/testing';
import { patchState, signalStore, withMethods, withState } from '@ngrx/signals';
import { CLOCK } from '../util/clock';
import { withAgentHistory } from './with-agent-history';

interface CounterState {
  count: number;
  items: { name: string }[];
}

const CounterStore = signalStore(
  withState<CounterState>({ count: 0, items: [{ name: 'a' }] }),
  withAgentHistory({ capacity: 3 }),
  withMethods((store) => ({
    increment: () => patchState(store, { count: store.count() + 1 }),
    rename: (name: string) => patchState(store, { items: [{ name }] }),
  })),
);

function createStore() {
  TestBed.configureTestingModule({
    providers: [CounterStore, { provide: CLOCK, useValue: () => new Date('2026-11-09T10:00:00Z') }],
  });
  return TestBed.inject(CounterStore);
}

describe('withAgentHistory', () => {
  it('starts empty and cannot undo', () => {
    const store = createStore();
    expect(store.history()).toEqual([]);
    expect(store.canUndo()).toBe(false);
    expect(store.lastEntry()).toBeNull();
  });

  it('restores the state captured before a mutation', () => {
    const store = createStore();
    store.recordSnapshot('before');
    store.increment();
    store.rename('b');
    const entry = store.undo();
    expect(entry?.label).toBe('before');
    expect(store.count()).toBe(0);
    expect(store.items()).toEqual([{ name: 'a' }]);
    expect(store.canUndo()).toBe(false);
  });

  it('excludes history from the snapshot and stamps the entry from CLOCK', () => {
    const store = createStore();
    store.recordSnapshot('one');
    store.recordSnapshot('two');
    const entry = store.lastEntry()!;
    expect(entry.snapshot).toEqual({ count: 0, items: [{ name: 'a' }] });
    expect(entry.at).toBe('2026-11-09T10:00:00.000Z');
  });

  it('stores a deep clone of the state', () => {
    const store = createStore();
    store.recordSnapshot('one');
    const snapshot = store.lastEntry()!.snapshot as unknown as CounterState;
    expect(snapshot.items).not.toBe(store.items());
    expect(snapshot.items[0]).not.toBe(store.items()[0]);
    snapshot.items[0]!.name = 'tampered';
    store.increment();
    store.undo();
    expect(store.items()).toEqual([{ name: 'tampered' }]);
  });

  it('keeps the live state independent of a restored snapshot', () => {
    const store = createStore();
    store.recordSnapshot('one');
    store.undo();
    store.rename('later');
    expect(store.items()).toEqual([{ name: 'later' }]);
  });

  it('evicts the oldest entries first at capacity', () => {
    const store = createStore();
    ['a', 'b', 'c', 'd', 'e'].forEach((label) => store.recordSnapshot(label));
    expect(store.history().map((e) => e.label)).toEqual(['c', 'd', 'e']);
  });

  it('assigns unique ids', () => {
    const store = createStore();
    const ids = [store.recordSnapshot('a'), store.recordSnapshot('b')];
    expect(new Set(ids).size).toBe(2);
  });

  it('undoes one step at a time', () => {
    const store = createStore();
    store.recordSnapshot('first');
    store.increment();
    store.recordSnapshot('second');
    store.increment();
    store.undo();
    expect(store.count()).toBe(1);
    store.undo();
    expect(store.count()).toBe(0);
  });

  it('undoTo restores the entry and drops it and every later entry', () => {
    const store = createStore();
    store.recordSnapshot('first');
    store.increment();
    const second = store.recordSnapshot('second');
    store.increment();
    store.recordSnapshot('third');
    store.increment();
    expect(store.undoTo(second)?.label).toBe('second');
    expect(store.count()).toBe(1);
    expect(store.history().map((e) => e.label)).toEqual(['first']);
  });

  it('treats undo on an empty history as a no-op', () => {
    const store = createStore();
    store.increment();
    expect(store.undo()).toBeNull();
    expect(store.count()).toBe(1);
  });

  it('treats undoTo with an unknown id as a no-op', () => {
    const store = createStore();
    store.recordSnapshot('one');
    store.increment();
    expect(store.undoTo('nope')).toBeNull();
    expect(store.count()).toBe(1);
    expect(store.history()).toHaveLength(1);
  });

  it('tracks canUndo as entries come and go', () => {
    const store = createStore();
    store.recordSnapshot('one');
    expect(store.canUndo()).toBe(true);
    store.undo();
    expect(store.canUndo()).toBe(false);
  });

  it('clears the history without touching state', () => {
    const store = createStore();
    store.recordSnapshot('one');
    store.increment();
    store.clearHistory();
    expect(store.history()).toEqual([]);
    expect(store.count()).toBe(1);
  });
});
