import { makeDeal } from '../../../../testing/deal-fixtures';
import {
  DISCOUNT_APPROVAL_PCT,
  IMPACT_APPROVAL_USD,
  assessDiscount,
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
