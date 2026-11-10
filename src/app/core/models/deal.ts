export const DEAL_STAGES = [
  'prospecting',
  'qualification',
  'proposal',
  'negotiation',
  'closed-won',
  'closed-lost',
] as const;

export type DealStage = (typeof DEAL_STAGES)[number];

export const REGIONS = ['APAC', 'EMEA', 'NA', 'LATAM'] as const;

export type Region = (typeof REGIONS)[number];

export type ContractStatus = 'none' | 'active' | 'terminated';

export const DEAL_STAGE_LABELS: Readonly<Record<DealStage, string>> = {
  prospecting: 'Prospecting',
  qualification: 'Qualification',
  proposal: 'Proposal',
  negotiation: 'Negotiation',
  'closed-won': 'Closed Won',
  'closed-lost': 'Closed Lost',
};

export const MAX_DISCOUNT_PCT = 50;
export const STALLED_AFTER_DAYS = 21;
export const AT_RISK_PROBABILITY = 25;

export interface Deal {
  id: string;
  account: string;
  title: string;
  owner: string;
  region: Region;
  stage: DealStage;
  listValue: number;
  discountPct: number;
  probability: number;
  closeDate: string;
  contractStatus: ContractStatus;
  contactEmail: string;
  lastActivityDays: number;
}

export function isClosedStage(stage: DealStage): boolean {
  return stage === 'closed-won' || stage === 'closed-lost';
}

export function isOpen(deal: Pick<Deal, 'stage'>): boolean {
  return !isClosedStage(deal.stage);
}

export function isStalled(deal: Pick<Deal, 'stage' | 'lastActivityDays'>): boolean {
  return isOpen(deal) && deal.lastActivityDays >= STALLED_AFTER_DAYS;
}

export function isAtRisk(deal: Pick<Deal, 'stage' | 'lastActivityDays' | 'probability'>): boolean {
  return isOpen(deal) && (isStalled(deal) || deal.probability < AT_RISK_PROBABILITY);
}
