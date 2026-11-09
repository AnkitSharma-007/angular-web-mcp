import type { Deal } from '../app/core/models/deal';

export function makeDeal(overrides: Partial<Deal> = {}): Deal {
  return {
    id: 'D-2001',
    account: 'Test Account',
    title: 'Test Deal',
    owner: 'Test Owner',
    region: 'NA',
    stage: 'proposal',
    listValue: 100000,
    discountPct: 0,
    probability: 50,
    closeDate: '2027-01-01',
    contractStatus: 'none',
    contactEmail: 'procurement@test.example',
    lastActivityDays: 1,
    ...overrides,
  };
}
