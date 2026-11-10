import { DEAL_STAGES, isAtRisk, isClosedStage, isOpen, isStalled, type DealStage } from './deal';

describe('deal predicates', () => {
  it('lists stages in funnel order', () => {
    expect(DEAL_STAGES).toEqual([
      'prospecting',
      'qualification',
      'proposal',
      'negotiation',
      'closed-won',
      'closed-lost',
    ]);
  });

  it.each<[DealStage, boolean]>([
    ['prospecting', false],
    ['negotiation', false],
    ['closed-won', true],
    ['closed-lost', true],
  ])('classifies %s as closed=%s', (stage, closed) => {
    expect(isClosedStage(stage)).toBe(closed);
    expect(isOpen({ stage })).toBe(!closed);
  });

  it('treats open deals idle for 21+ days as stalled', () => {
    expect(isStalled({ stage: 'proposal', lastActivityDays: 21 })).toBe(true);
    expect(isStalled({ stage: 'proposal', lastActivityDays: 20 })).toBe(false);
  });

  it('never marks closed deals as stalled or at risk', () => {
    expect(isStalled({ stage: 'closed-won', lastActivityDays: 90 })).toBe(false);
    expect(isAtRisk({ stage: 'closed-lost', lastActivityDays: 90, probability: 0 })).toBe(false);
  });

  it('flags stalled or low-probability open deals as at risk', () => {
    expect(isAtRisk({ stage: 'proposal', lastActivityDays: 30, probability: 80 })).toBe(true);
    expect(isAtRisk({ stage: 'proposal', lastActivityDays: 1, probability: 24 })).toBe(true);
    expect(isAtRisk({ stage: 'proposal', lastActivityDays: 1, probability: 25 })).toBe(false);
  });
});
