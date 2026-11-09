import {
  PROPOSAL_KEYS,
  PRODUCT_TIERS,
  createProposalModel,
  isBillingDate,
  isIsoDate,
} from './proposal';

describe('proposal model', () => {
  it('starts without nulls or undefined and with a non-empty line item list', () => {
    const model = createProposalModel();
    expect(Object.keys(model).sort()).toEqual([...PROPOSAL_KEYS].sort());
    for (const value of Object.values(model)) {
      expect(value).not.toBeNull();
      expect(value).not.toBeUndefined();
    }
    expect(model.lineItems.length).toBeGreaterThan(0);
    expect(PRODUCT_TIERS).toContain(model.productTier);
  });

  it('seeds the identifying fields and gives each model its own line items', () => {
    const seeded = createProposalModel({ dealId: 'D-1001', clientName: 'Konkan Freight' });
    expect(seeded).toMatchObject({ dealId: 'D-1001', clientName: 'Konkan Freight' });
    expect(createProposalModel().lineItems).not.toBe(createProposalModel().lineItems);
  });

  it.each([
    ['2027-01-01', true],
    ['2026-12-15', true],
    ['2027-02-30', false],
    ['2027-13-01', false],
    ['01/01/2027', false],
    ['', false],
  ])('isIsoDate(%s) is %s', (value, expected) => {
    expect(isIsoDate(value)).toBe(expected);
  });

  it.each([
    ['2027-01-01', true],
    ['2026-12-15', false],
    ['2027-02-30', false],
    ['not a date', false],
  ])('isBillingDate(%s) is %s', (value, expected) => {
    expect(isBillingDate(value)).toBe(expected);
  });
});
