import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { form } from '@angular/forms/signals';
import { PROPOSAL_KEYS, createProposalModel, type ProposalModel } from '../../core/models/proposal';
import { PROPOSAL_TOOL_DESCRIPTION, PROPOSAL_TOOL_NAME, proposalSchema } from './proposal-form';

const VALID: ProposalModel = {
  dealId: 'D-1001',
  clientName: 'Konkan Freight',
  contactEmail: 'procurement@konkan.example',
  productTier: 'Enterprise',
  seats: 250,
  termMonths: 24,
  discountPct: 10,
  startDate: '2027-01-01',
  lineItems: ['Platform license'],
};

function setup(overrides: Partial<ProposalModel> = {}) {
  const model = signal<ProposalModel>({ ...VALID, ...overrides });
  const tree = TestBed.runInInjectionContext(() =>
    form(
      model,
      proposalSchema((id) => id === 'D-1001'),
    ),
  );
  const messages = (key: keyof ProposalModel) =>
    tree[key]()
      .errors()
      .map((e) => e.message);
  return { model, tree, messages };
}

describe('proposal form schema', () => {
  it('accepts a fully valid proposal', () => {
    expect(setup().tree().valid()).toBe(true);
  });

  it('marks every agent-facing field as required', () => {
    const { tree } = setup();
    for (const key of PROPOSAL_KEYS) {
      expect(tree[key]().required(), key).toBe(true);
    }
  });

  it('reports every blank field in the untouched initial model', () => {
    const model = signal(createProposalModel());
    const tree = TestBed.runInInjectionContext(() =>
      form(
        model,
        proposalSchema(() => true),
      ),
    );
    const failing = PROPOSAL_KEYS.filter((key) => tree[key]().errors().length > 0);
    expect(failing).toEqual(['dealId', 'clientName', 'contactEmail', 'startDate']);
  });

  it('rejects an unknown deal ID and accepts a known one', () => {
    expect(setup({ dealId: 'D-9999' }).messages('dealId')).toEqual(['No deal with ID "D-9999"']);
    expect(setup({ dealId: 'D-1001' }).messages('dealId')).toEqual([]);
  });

  it('validates the email address', () => {
    expect(setup({ contactEmail: 'nope' }).messages('contactEmail')).toEqual([
      'Enter a valid email address',
    ]);
  });

  it('rejects a tier that is not offered', () => {
    const { messages } = setup({ productTier: 'Platinum' as ProposalModel['productTier'] });
    expect(messages('productTier')).toEqual(['Tier must be one of: Starter, Growth, Enterprise']);
  });

  it.each([
    ['seats', 0, 'At least 1 seat'],
    ['seats', 5001, 'At most 5000 seats'],
    ['seats', 2.5, 'Seats must be a whole number'],
    ['termMonths', 5, 'Term is at least 6 months'],
    ['termMonths', 61, 'Term is at most 60 months'],
    ['termMonths', 7.5, 'Term must be a whole number of months'],
    ['discountPct', -1, 'Discount cannot be negative'],
    ['discountPct', 41, 'Discount is at most 40%'],
  ] as const)('rejects %s = %s', (key, value, message) => {
    expect(setup({ [key]: value }).messages(key)).toEqual([message]);
  });

  it.each([
    ['seats', 1],
    ['seats', 5000],
    ['termMonths', 6],
    ['termMonths', 60],
    ['discountPct', 0],
    ['discountPct', 40],
  ] as const)('accepts the bound %s = %s', (key, value) => {
    expect(setup({ [key]: value }).messages(key)).toEqual([]);
  });

  it('rejects a start date that is not the 1st and accepts one that is', () => {
    expect(setup({ startDate: '2026-12-15' }).messages('startDate')).toEqual([
      'Start date must be the 1st of a month (billing cycle), for example 2027-01-01',
    ]);
    expect(setup({ startDate: '2027-01-01' }).messages('startDate')).toEqual([]);
  });

  it('rejects a start date that is not an ISO date', () => {
    expect(setup({ startDate: '1 January 2027' }).messages('startDate')).toEqual([
      'Use an ISO date, YYYY-MM-DD',
    ]);
  });

  it('requires at least one non-blank line item', () => {
    expect(setup({ lineItems: [] }).messages('lineItems')).toEqual(['Add at least one line item']);
    const { tree } = setup({ lineItems: ['Platform license', ''] });
    expect(
      tree.lineItems[1]!()
        .errors()
        .map((e) => e.message),
    ).toEqual(['Line item cannot be blank']);
  });

  it('tells the agent the tier values, date format and billing rule in the description', () => {
    expect(PROPOSAL_TOOL_NAME).toBe('draftDealProposal');
    for (const text of ['Starter', 'Growth', 'Enterprise', 'YYYY-MM-DD', '1st of a month']) {
      expect(PROPOSAL_TOOL_DESCRIPTION).toContain(text);
    }
  });
});
