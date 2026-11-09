import type { Deal, DealStage } from '../../../core/models/deal';
import { formatCompactCurrency, netValue, roundMoney } from '../../../core/util/money';
import { planStageMoves } from '../data/with-deals';

export const DISCOUNT_APPROVAL_PCT = 15;
export const IMPACT_APPROVAL_USD = 250_000;
export const CLOSED_LOST_APPROVAL_USD = 100_000;

export interface DiscountChange {
  id: string;
  account: string;
  before: number;
  after: number;
  impact: number;
}

export interface DiscountAssessment {
  changes: DiscountChange[];
  revenueImpact: number;
  flags: string[];
}

export interface StageMove {
  dealId: string;
  stage: DealStage;
}

export interface PlannedStageMove {
  id: string;
  account: string;
  before: DealStage;
  after: DealStage;
  netValue: number;
  flagged: boolean;
  effect: string | null;
}

export interface StageAssessment {
  flaggedDeals: { id: string; account: string; netValue: number }[];
  moves: PlannedStageMove[];
  flags: string[];
}

function stageEffect(stage: DealStage): string | null {
  switch (stage) {
    case 'closed-won':
      return 'Probability set to 100% and the contract is activated';
    case 'closed-lost':
      return 'Probability set to 0%';
    default:
      return null;
  }
}

export function discountImpact(listValue: number, before: number, after: number): number {
  return -roundMoney((listValue * (after - before)) / 100);
}

export function assessDiscount(
  deals: readonly (Deal | undefined)[],
  discountPct: number,
): DiscountAssessment {
  const changes = deals.flatMap((deal) =>
    deal && deal.discountPct !== discountPct
      ? [
          {
            id: deal.id,
            account: deal.account,
            before: deal.discountPct,
            after: discountPct,
            impact: discountImpact(deal.listValue, deal.discountPct, discountPct),
          },
        ]
      : [],
  );
  const revenueImpact = roundMoney(changes.reduce((sum, change) => sum + change.impact, 0));
  const flags: string[] = [];
  if (discountPct > DISCOUNT_APPROVAL_PCT) {
    flags.push(`Discount of ${discountPct}% is above the ${DISCOUNT_APPROVAL_PCT}% policy limit`);
  }
  if (-revenueImpact > IMPACT_APPROVAL_USD) {
    flags.push(
      `Revenue impact of ${formatCompactCurrency(revenueImpact)} is above the ` +
        `${formatCompactCurrency(IMPACT_APPROVAL_USD)} policy limit`,
    );
  }
  return { changes, revenueImpact, flags };
}

export function assessStageMoves(
  entities: Readonly<Record<string, Deal | undefined>>,
  moves: readonly StageMove[],
): StageAssessment {
  const planned = planStageMoves(entities, moves).changed.flatMap(({ id, before, after }) => {
    const deal = entities[id];
    return deal
      ? [
          {
            id,
            account: deal.account,
            before,
            after,
            netValue: netValue(deal),
            flagged: after === 'closed-lost' && netValue(deal) > CLOSED_LOST_APPROVAL_USD,
            effect: stageEffect(after),
          },
        ]
      : [];
  });
  const flaggedDeals = planned
    .filter((move) => move.flagged)
    .map(({ id, account, netValue: value }) => ({ id, account, netValue: value }));
  const ordered = [
    ...planned.filter((move) => move.flagged),
    ...planned.filter((move) => !move.flagged),
  ];
  const flags = flaggedDeals.length
    ? [
        `${flaggedDeals.length} deal${flaggedDeals.length === 1 ? '' : 's'} over ` +
          `${formatCompactCurrency(CLOSED_LOST_APPROVAL_USD)} would be marked closed-lost`,
      ]
    : [];
  return { flaggedDeals, moves: ordered, flags };
}
