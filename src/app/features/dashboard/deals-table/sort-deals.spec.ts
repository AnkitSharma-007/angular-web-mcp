import { makeDeal } from '../../../../testing/deal-fixtures';
import { sortDeals } from './sort-deals';

const deals = [
  makeDeal({
    id: 'D-1',
    account: 'beta',
    listValue: 200000,
    stage: 'negotiation',
    discountPct: 50,
  }),
  makeDeal({ id: 'D-2', account: 'Alpha', listValue: 300000, stage: 'prospecting' }),
  makeDeal({ id: 'D-3', account: 'Gamma', listValue: 50000, stage: 'closed-won' }),
];

const ids = (sorted: ReturnType<typeof sortDeals>) => sorted.map((deal) => deal.id);

describe('sortDeals', () => {
  it('keeps the input order when no direction is set', () => {
    expect(ids(sortDeals(deals, { active: 'account', direction: '' }))).toEqual([
      'D-1',
      'D-2',
      'D-3',
    ]);
  });

  it('keeps the input order for an unknown column', () => {
    expect(ids(sortDeals(deals, { active: 'nope', direction: 'asc' }))).toEqual([
      'D-1',
      'D-2',
      'D-3',
    ]);
  });

  it('sorts text case-insensitively', () => {
    expect(ids(sortDeals(deals, { active: 'account', direction: 'asc' }))).toEqual([
      'D-2',
      'D-1',
      'D-3',
    ]);
  });

  it('sorts by net value, not list value', () => {
    expect(ids(sortDeals(deals, { active: 'netValue', direction: 'desc' }))).toEqual([
      'D-2',
      'D-1',
      'D-3',
    ]);
    expect(ids(sortDeals(deals, { active: 'netValue', direction: 'asc' }))).toEqual([
      'D-3',
      'D-1',
      'D-2',
    ]);
  });

  it('sorts stages by pipeline order', () => {
    expect(ids(sortDeals(deals, { active: 'stage', direction: 'asc' }))).toEqual([
      'D-2',
      'D-1',
      'D-3',
    ]);
  });

  it('breaks ties by id and does not mutate the input', () => {
    const tied = [makeDeal({ id: 'D-9' }), makeDeal({ id: 'D-8' })];
    expect(ids(sortDeals(tied, { active: 'region', direction: 'desc' }))).toEqual(['D-8', 'D-9']);
    expect(ids(tied)).toEqual(['D-9', 'D-8']);
  });
});
