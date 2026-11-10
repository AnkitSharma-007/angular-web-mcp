import { TestBed } from '@angular/core/testing';
import { patchState } from '@ngrx/signals';
import { setAllEntities } from '@ngrx/signals/entities';
import { unprotected } from '@ngrx/signals/testing';
import { DEAL_STAGES, REGIONS, type Deal } from '../../../core/models/deal';
import { makeDeal } from '../../../../testing/deal-fixtures';
import { DealsStore } from './deals-store';
import { clampDiscount } from './with-deals';

function createStore() {
  TestBed.configureTestingModule({ providers: [DealsStore] });
  return TestBed.inject(DealsStore);
}

describe('withDeals', () => {
  describe('stage breakdown', () => {
    it('lists every stage in funnel order', () => {
      expect(
        createStore()
          .pipelineByStage()
          .map((s) => s.key),
      ).toEqual([...DEAL_STAGES]);
    });

    it('sums percentages to roughly 100', () => {
      const total = createStore()
        .pipelineByStage()
        .reduce((sum, s) => sum + s.pct, 0);
      expect(total).toBeGreaterThan(99.8);
      expect(total).toBeLessThan(100.2);
    });

    it('counts all deals across stages', () => {
      const count = createStore()
        .pipelineByStage()
        .reduce((sum, s) => sum + s.count, 0);
      expect(count).toBe(24);
    });

    it('reports zero percentages for an empty store', () => {
      const store = createStore();
      patchState(unprotected(store), setAllEntities<Deal>([]));
      expect(store.pipelineByStage().every((s) => s.pct === 0 && s.count === 0)).toBe(true);
    });

    it('breaks down by region in region order', () => {
      const store = createStore();
      expect(store.byRegion().map((r) => r.key)).toEqual([...REGIONS]);
      expect(store.byRegion().reduce((sum, r) => sum + r.count, 0)).toBe(24);
    });
  });

  describe('KPIs', () => {
    beforeEach(() => {
      const store = createStore();
      patchState(
        unprotected(store),
        setAllEntities([
          makeDeal({ id: 'D-3001', listValue: 100000, probability: 50 }),
          makeDeal({ id: 'D-3002', listValue: 200000, discountPct: 50, probability: 10 }),
          makeDeal({ id: 'D-3003', stage: 'closed-won', listValue: 80000, discountPct: 25 }),
          makeDeal({ id: 'D-3004', stage: 'closed-lost', listValue: 40000 }),
          makeDeal({ id: 'D-3005', lastActivityDays: 30 }),
        ]),
      );
    });

    it('weights open pipeline by probability on net value', () => {
      expect(TestBed.inject(DealsStore).kpis().weightedForecast).toBe(
        100000 * 0.5 + 100000 * 0.1 + 100000 * 0.5,
      );
    });

    it('totals open and won value on net value', () => {
      const kpis = TestBed.inject(DealsStore).kpis();
      expect(kpis.openDeals).toBe(3);
      expect(kpis.openValue).toBe(300000);
      expect(kpis.wonValue).toBe(60000);
    });

    it('computes the win rate from closed deals', () => {
      expect(TestBed.inject(DealsStore).kpis().winRate).toBe(50);
    });

    it('counts stalled open deals', () => {
      expect(TestBed.inject(DealsStore).kpis().stalledCount).toBe(1);
    });

    it('reports a zero win rate with no closed deals', () => {
      const store = TestBed.inject(DealsStore);
      patchState(unprotected(store), setAllEntities([makeDeal()]));
      expect(store.kpis().winRate).toBe(0);
    });

    it('flags stalled and low-probability open deals as at risk', () => {
      expect(
        TestBed.inject(DealsStore)
          .atRiskDeals()
          .map((d) => d.id),
      ).toEqual(['D-3002', 'D-3005']);
    });
  });

  describe('seed KPIs', () => {
    it('has a 60% win rate and 19 open deals', () => {
      const kpis = createStore().kpis();
      expect(kpis.winRate).toBe(60);
      expect(kpis.openDeals).toBe(19);
      expect(kpis.stalledCount).toBe(4);
    });
  });

  describe('query', () => {
    it('matches case-insensitively across account, title, owner and id', () => {
      const store = createStore();
      store.setQuery('ARCADIA');
      expect(store.filteredDeals().map((d) => d.id)).toEqual(['D-1002']);
      store.setQuery('fleet');
      expect(store.filteredDeals()).toHaveLength(2);
      store.setQuery('kenji');
      expect(store.filteredDeals().every((d) => d.owner === 'Kenji Sato')).toBe(true);
      store.setQuery('d-1010');
      expect(store.filteredDeals()).toHaveLength(1);
    });

    it('ignores surrounding whitespace', () => {
      const store = createStore();
      store.setQuery('  arcadia  ');
      expect(store.filteredDeals()).toHaveLength(1);
    });

    it('shows every deal again when cleared', () => {
      const store = createStore();
      store.setQuery('arcadia');
      store.setQuery('');
      expect(store.filteredDeals()).toHaveLength(24);
    });

    it('does not touch the entities', () => {
      const store = createStore();
      store.setQuery('arcadia');
      expect(store.entities()).toHaveLength(24);
    });
  });

  describe('search', () => {
    it('returns only stalled open deals with stalledOnly', () => {
      const result = createStore().search({ stalledOnly: true });
      expect(result.total).toBe(4);
      expect(result.deals.map((d) => d.account).sort()).toEqual([
        'Copacabana Retail',
        'Granite Construction',
        'Orion Pharma',
        'Zephyr Wind',
      ]);
    });

    it('ignores the table search', () => {
      const store = createStore();
      store.setQuery('arcadia');
      expect(store.search().total).toBe(24);
    });

    it('filters by stage, region, probability and value bounds', () => {
      const store = createStore();
      expect(
        store.search({ stages: ['negotiation'], regions: ['EMEA'], minProbability: 71 }).total,
      ).toBe(2);
      expect(store.search({ minValue: 390000, maxValue: 450000 }).total).toBe(2);
    });

    it('orders by net value descending and honours the limit', () => {
      const result = createStore().search({ limit: 3 });
      expect(result.total).toBe(24);
      expect(result.deals.map((d) => d.id)).toEqual(['D-1015', 'D-1009', 'D-1002']);
    });

    it('searches by text', () => {
      expect(createStore().search({ query: 'konkan' }).deals).toHaveLength(1);
    });
  });

  describe('mutation guards', () => {
    it.each([
      [-5, 0],
      [0, 0],
      [25, 25],
      [50, 50],
      [90, 50],
    ])('clamps a %s%% discount to %s%%', (input, expected) => {
      expect(clampDiscount(input)).toBe(expected);
    });

    it('applies the clamped discount to the deal', () => {
      const store = createStore();
      const result = store.applyDiscount(['D-1002'], 75);
      expect(result.changed).toEqual([{ id: 'D-1002', before: 0, after: 50 }]);
      expect(store.entityMap()['D-1002']?.discountPct).toBe(50);
    });

    it('reports unknown IDs and unchanged deals as skipped without failing the batch', () => {
      const store = createStore();
      const result = store.applyDiscount(['D-1002', 'D-9999', 'D-1004'], 5);
      expect(result.changed.map((c) => c.id)).toEqual(['D-1002']);
      expect(result.skipped).toEqual([
        { id: 'D-9999', why: 'unknown deal' },
        { id: 'D-1004', why: 'already at 5%' },
      ]);
    });

    it('terminates an active closed-won contract once', () => {
      const store = createStore();
      const first = store.terminateContract('D-1003');
      expect(first.changed).toEqual([{ id: 'D-1003', before: 'active', after: 'terminated' }]);
      expect(store.entityMap()['D-1003']?.contractStatus).toBe('terminated');
      expect(store.terminateContract('D-1003').skipped[0]?.why).toBe('contract is not active');
    });

    it('refuses to terminate open or unknown deals', () => {
      const store = createStore();
      expect(store.terminateContract('D-1002').skipped[0]?.why).toBe(
        'only closed-won deals have a contract',
      );
      expect(store.terminateContract('D-0000').skipped[0]?.why).toBe('unknown deal');
      expect(store.entityMap()['D-1002']?.contractStatus).toBe('none');
    });

    it('resets entities and query to the seed', () => {
      const store = createStore();
      store.applyDiscount(['D-1002'], 20);
      store.terminateContract('D-1001');
      store.setQuery('x');
      store.reset();
      expect(store.entityMap()['D-1002']?.discountPct).toBe(0);
      expect(store.entityMap()['D-1001']?.contractStatus).toBe('active');
      expect(store.query()).toBe('');
      expect(store.entities()).toHaveLength(24);
    });
  });
});
