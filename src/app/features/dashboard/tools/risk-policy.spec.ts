import { makeDeal } from '../../../../testing/deal-fixtures';
import {
  CLOSED_LOST_APPROVAL_USD,
  DISCOUNT_APPROVAL_PCT,
  IMPACT_APPROVAL_USD,
  assessDiscount,
  assessStageMoves,
  discountImpact,
} from './risk-policy';

const small = makeDeal({ id: 'D-3001', listValue: 100_000 });

describe('assessDiscount', () => {
  it('needs no approval at exactly 15 % and flags 15.01 %', () => {
    expect(DISCOUNT_APPROVAL_PCT).toBe(15);
    expect(assessDiscount([small], 15).flags).toEqual([]);
    expect(assessDiscount([small], 15.01).flags).toEqual([
      'Discount of 15.01% is above the 15% policy limit',
    ]);
  });

  it('flags a revenue impact over $250k even at 10 %', () => {
    const big = [1, 2, 3].map((n) => makeDeal({ id: `D-300${n}`, listValue: 1_000_000 }));
    const assessment = assessDiscount(big, 10);
    expect(assessment.revenueImpact).toBe(-300_000);
    expect(assessment.flags).toEqual(['Revenue impact of -$300k is above the $250k policy limit']);
  });

  it('does not flag an impact of exactly $250k', () => {
    const exact = assessDiscount([makeDeal({ listValue: 2_500_000 })], 10);
    expect(exact.revenueImpact).toBe(-IMPACT_APPROVAL_USD);
    expect(exact.flags).toEqual([]);
  });

  it('reports both flags together', () => {
    const assessment = assessDiscount([makeDeal({ listValue: 2_000_000 })], 20);
    expect(assessment.flags).toHaveLength(2);
  });

  it('does not treat a smaller discount as a revenue loss', () => {
    const assessment = assessDiscount([makeDeal({ listValue: 5_000_000, discountPct: 20 })], 10);
    expect(assessment.revenueImpact).toBe(500_000);
    expect(assessment.flags).toEqual([]);
  });

  it('lists per-deal before and after, and ignores unknown or unchanged deals', () => {
    const unchanged = makeDeal({ id: 'D-3002', discountPct: 5 });
    const assessment = assessDiscount([small, undefined, unchanged], 5);
    expect(assessment.changes).toEqual([
      { id: 'D-3001', account: 'Test Account', before: 0, after: 5, impact: -5_000 },
    ]);
  });

  it('computes the impact from list value and the percentage delta', () => {
    expect(discountImpact(420_000, 0, 10)).toBe(-42_000);
    expect(discountImpact(420_000, 10, 0)).toBe(42_000);
  });
});

describe('assessStageMoves', () => {
  const entities = {
    big: makeDeal({ id: 'D-3010', account: 'Big', listValue: 250_000 }),
    edge: makeDeal({ id: 'D-3011', listValue: CLOSED_LOST_APPROVAL_USD }),
    discounted: makeDeal({ id: 'D-3012', listValue: 120_000, discountPct: 20 }),
    closed: makeDeal({ id: 'D-3013', listValue: 900_000, stage: 'closed-won' }),
  };
  const byId = Object.fromEntries(Object.values(entities).map((deal) => [deal.id, deal]));

  it('flags an open deal over $100k moving to closed-lost', () => {
    const assessment = assessStageMoves(byId, [{ dealId: 'D-3010', stage: 'closed-lost' }]);
    expect(assessment.flaggedDeals).toEqual([{ id: 'D-3010', account: 'Big', netValue: 250_000 }]);
    expect(assessment.flags).toEqual(['1 deal over $100k would be marked closed-lost']);
  });

  it('uses net value, so exactly $100k and discounted deals pass', () => {
    const moves = ['D-3011', 'D-3012'].map((dealId) => ({
      dealId,
      stage: 'closed-lost' as const,
    }));
    expect(assessStageMoves(byId, moves).flags).toEqual([]);
  });

  it('ignores other target stages, closed deals and unknown ids', () => {
    const moves = [
      { dealId: 'D-3010', stage: 'closed-won' as const },
      { dealId: 'D-3013', stage: 'closed-lost' as const },
      { dealId: 'D-9999', stage: 'closed-lost' as const },
    ];
    expect(assessStageMoves(byId, moves).flaggedDeals).toEqual([]);
  });

  it('pluralises the message', () => {
    const second = makeDeal({ id: 'D-3014', listValue: 500_000 });
    const assessment = assessStageMoves({ ...byId, [second.id]: second }, [
      { dealId: 'D-3010', stage: 'closed-lost' },
      { dealId: 'D-3014', stage: 'closed-lost' },
    ]);
    expect(assessment.flags).toEqual(['2 deals over $100k would be marked closed-lost']);
  });
});
