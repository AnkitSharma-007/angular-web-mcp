import { InjectionToken, Injector, inject } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { signalStore, signalStoreFeature, withFeature, withHooks, withState } from '@ngrx/signals';
import { SEED_DEALS } from '../../../core/data/seed-deals';
import { DealsStore } from './deals-store';

const MARKER = new InjectionToken<string>('MARKER');

describe('A7: injection context in store factories', () => {
  it('runs the withHooks factory in an injection context', () => {
    let injector: Injector | undefined;
    const Store = signalStore(
      { providedIn: 'root' },
      withState({ ready: false }),
      withHooks(() => {
        injector = inject(Injector);
        return { onInit: () => undefined };
      }),
    );
    TestBed.inject(Store);
    expect(injector?.get(MARKER, 'fallback')).toBe('fallback');
  });

  it('runs the withFeature factory in an injection context', () => {
    let marker: string | undefined;
    const Store = signalStore(
      { providedIn: 'root' },
      withState({ ready: false }),
      withFeature(() => {
        marker = inject(MARKER);
        return signalStoreFeature(withState({ extra: 1 }));
      }),
    );
    TestBed.configureTestingModule({ providers: [{ provide: MARKER, useValue: 'ok' }] });
    TestBed.inject(Store);
    expect(marker).toBe('ok');
  });
});

describe('DealsStore', () => {
  beforeEach(() => TestBed.configureTestingModule({ providers: [DealsStore] }));

  it('loads the seed on init', () => {
    const store = TestBed.inject(DealsStore);
    expect(store.entities()).toEqual(SEED_DEALS);
    expect(store.canUndo()).toBe(false);
  });

  it('composes deals with agent history', () => {
    const store = TestBed.inject(DealsStore);
    store.recordSnapshot('before');
    store.applyDiscount(['D-1002'], 25);
    expect(store.entityMap()['D-1002']?.discountPct).toBe(25);
    store.undo();
    expect(store.entityMap()['D-1002']?.discountPct).toBe(0);
  });
});
