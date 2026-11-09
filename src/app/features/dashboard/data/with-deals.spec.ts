import { TestBed } from '@angular/core/testing';
import { DealsStore } from './deals-store';

function createStore() {
  TestBed.configureTestingModule({ providers: [DealsStore] });
  return TestBed.inject(DealsStore);
}

describe('withDeals (smoke)', () => {
  it('derives stage and region breakdowns, KPIs and at-risk deals', () => {
    const store = createStore();
    expect(store.pipelineByStage().map((s) => s.key)).toHaveLength(6);
    expect(store.byRegion().map((r) => r.key)).toEqual(['APAC', 'EMEA', 'NA', 'LATAM']);
    expect(store.kpis().openDeals).toBe(19);
    expect(store.atRiskDeals().length).toBeGreaterThan(0);
  });

  it('filters, searches and clears the filter', () => {
    const store = createStore();
    store.setFilter({ regions: ['EMEA'], stages: ['negotiation'] });
    expect(store.filteredDeals()).toHaveLength(4);
    store.setFilter({ query: 'IBERIA' });
    expect(store.filteredDeals().map((d) => d.id)).toEqual(['D-1006']);
    store.clearFilter();
    expect(store.filteredDeals()).toHaveLength(24);
    expect(store.search({ stalledOnly: true }).total).toBe(4);
  });

  it('applies discounts with clamping and reports skips', () => {
    const store = createStore();
    const result = store.applyDiscount(['D-1002', 'D-9999'], 90);
    expect(result.changed).toEqual([{ id: 'D-1002', before: 0, after: 50 }]);
    expect(result.skipped).toEqual([{ id: 'D-9999', why: 'unknown deal' }]);
    expect(store.applyDiscount(['D-1002'], 50).skipped).toHaveLength(1);
  });

  it('moves stages without reopening closed deals', () => {
    const store = createStore();
    const result = store.moveStages([
      { dealId: 'D-1004', stage: 'closed-won' },
      { dealId: 'D-1001', stage: 'proposal' },
      { dealId: 'D-1005', stage: 'negotiation' },
      { dealId: 'D-0000', stage: 'proposal' },
    ]);
    expect(result.changed).toHaveLength(1);
    expect(result.skipped).toHaveLength(3);
    expect(store.entityMap()['D-1004']).toMatchObject({
      stage: 'closed-won',
      probability: 100,
      contractStatus: 'active',
    });
    store.moveStages([{ dealId: 'D-1020', stage: 'closed-lost' }]);
    expect(store.entityMap()['D-1020']?.probability).toBe(0);
  });

  it('terminates only active closed-won contracts', () => {
    const store = createStore();
    expect(store.terminateContract('D-1003').changed).toHaveLength(1);
    expect(store.terminateContract('D-1003').skipped[0]?.why).toBe('contract is not active');
    expect(store.terminateContract('D-1002').skipped[0]?.why).toBe(
      'only closed-won deals have a contract',
    );
    expect(store.terminateContract('D-0000').skipped[0]?.why).toBe('unknown deal');
  });

  it('resets to the seed', () => {
    const store = createStore();
    store.applyDiscount(['D-1002'], 20);
    store.setFilter({ query: 'x' });
    store.reset();
    expect(store.entityMap()['D-1002']?.discountPct).toBe(0);
    expect(store.filter().query).toBe('');
  });
});

describe('withAgentHistory (smoke)', () => {
  it('records, undoes to an entry and clears history', () => {
    const store = createStore();
    const first = store.recordSnapshot('one');
    store.applyDiscount(['D-1002'], 10);
    store.recordSnapshot('two');
    store.applyDiscount(['D-1002'], 20);
    expect(store.lastEntry()?.label).toBe('two');
    store.undoTo(first);
    expect(store.entityMap()['D-1002']?.discountPct).toBe(0);
    expect(store.history()).toHaveLength(0);
    expect(store.undo()).toBeNull();
    expect(store.undoTo('missing')).toBeNull();
    store.recordSnapshot('three');
    store.clearHistory();
    expect(store.canUndo()).toBe(false);
  });
});
