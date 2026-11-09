import { DEAL_STAGES, isStalled, MAX_DISCOUNT_PCT, REGIONS } from '../models/deal';
import { createSeedDeals, SEED_DEALS } from './seed-deals';

describe('seed deals', () => {
  it('has 24 deals with unique, sequential IDs from D-1001', () => {
    const ids = SEED_DEALS.map((deal) => deal.id);
    expect(ids).toEqual(Array.from({ length: 24 }, (_, i) => `D-${1001 + i}`));
    expect(new Set(ids).size).toBe(24);
  });

  it('has at least four EMEA negotiation deals, two above 70% probability', () => {
    const emea = SEED_DEALS.filter((d) => d.region === 'EMEA' && d.stage === 'negotiation');
    expect(emea.length).toBeGreaterThanOrEqual(4);
    expect(emea.filter((d) => d.probability > 70).length).toBe(2);
  });

  it('keeps the EMEA negotiation 10% discount under the approval threshold', () => {
    const emea = SEED_DEALS.filter((d) => d.region === 'EMEA' && d.stage === 'negotiation');
    const impact = emea.reduce((sum, d) => sum + d.listValue * 0.1, 0);
    expect(impact).toBeLessThan(250000);
  });

  it('has the Konkan Freight closed-won active contract', () => {
    expect(SEED_DEALS.find((d) => d.account === 'Konkan Freight')).toMatchObject({
      stage: 'closed-won',
      contractStatus: 'active',
    });
  });

  it('has Arcadia Bank in negotiation at $420k, outside the EMEA set', () => {
    expect(SEED_DEALS.find((d) => d.account === 'Arcadia Bank')).toMatchObject({
      stage: 'negotiation',
      listValue: 420000,
      discountPct: 0,
      region: 'NA',
    });
  });

  it('has the Monsoon Retail closed-won active contract', () => {
    expect(SEED_DEALS.find((d) => d.account === 'Monsoon Retail')).toMatchObject({
      stage: 'closed-won',
      contractStatus: 'active',
    });
  });

  it('has at least three stalled deals', () => {
    expect(SEED_DEALS.filter(isStalled).length).toBeGreaterThanOrEqual(3);
  });

  it('has valid values on every deal', () => {
    for (const deal of SEED_DEALS) {
      expect(DEAL_STAGES).toContain(deal.stage);
      expect(REGIONS).toContain(deal.region);
      expect(deal.listValue).toBeGreaterThan(0);
      expect(deal.discountPct).toBeGreaterThanOrEqual(0);
      expect(deal.discountPct).toBeLessThanOrEqual(MAX_DISCOUNT_PCT);
      expect(deal.probability).toBeGreaterThanOrEqual(0);
      expect(deal.probability).toBeLessThanOrEqual(100);
      expect(deal.lastActivityDays).toBeGreaterThanOrEqual(0);
      expect(deal.closeDate).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(Number.isNaN(Date.parse(deal.closeDate))).toBe(false);
      expect(deal.contactEmail).toMatch(/^[a-z0-9-]+@[a-z0-9-]+\.example$/);
      expect(deal.account).not.toBe('');
      expect(deal.owner).not.toBe('');
    }
  });

  it('keeps probability and contract status consistent with the stage', () => {
    for (const deal of SEED_DEALS) {
      if (deal.stage === 'closed-won') {
        expect(deal.probability).toBe(100);
        expect(deal.contractStatus).toBe('active');
      } else {
        expect(deal.contractStatus).toBe('none');
      }
      if (deal.stage === 'closed-lost') {
        expect(deal.probability).toBe(0);
      }
    }
  });

  it('covers every stage and region', () => {
    expect(new Set(SEED_DEALS.map((d) => d.stage))).toEqual(new Set(DEAL_STAGES));
    expect(new Set(SEED_DEALS.map((d) => d.region))).toEqual(new Set(REGIONS));
  });

  it('hands out independent copies', () => {
    const copy = createSeedDeals();
    copy[0]!.discountPct = 40;
    expect(SEED_DEALS[0]!.discountPct).toBe(5);
    expect(createSeedDeals()).toEqual(SEED_DEALS);
  });
});
