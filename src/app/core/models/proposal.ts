export const PRODUCT_TIERS = ['Starter', 'Growth', 'Enterprise'] as const;

export type ProductTier = (typeof PRODUCT_TIERS)[number];

export const SEATS_MIN = 1;
export const SEATS_MAX = 5000;
export const TERM_MIN_MONTHS = 6;
export const TERM_MAX_MONTHS = 60;
export const PROPOSAL_DISCOUNT_MAX = 40;
export const STARTER_SEAT_LIMIT = 1000;

export interface ProposalModel {
  dealId: string;
  clientName: string;
  contactEmail: string;
  productTier: ProductTier;
  seats: number;
  termMonths: number;
  discountPct: number;
  startDate: string;
  lineItems: string[];
}

export type ProposalKey = keyof ProposalModel;

export const PROPOSAL_KEYS: readonly ProposalKey[] = [
  'dealId',
  'clientName',
  'contactEmail',
  'productTier',
  'seats',
  'termMonths',
  'discountPct',
  'startDate',
  'lineItems',
];

export interface ProposalDraft extends ProposalModel {
  id: string;
  savedAt: string;
}

export interface ProposalSeed {
  dealId?: string;
  clientName?: string;
  contactEmail?: string;
}

export function createProposalModel(seed: ProposalSeed = {}): ProposalModel {
  return {
    dealId: seed.dealId ?? '',
    clientName: seed.clientName ?? '',
    contactEmail: seed.contactEmail ?? '',
    productTier: 'Growth',
    seats: 1,
    termMonths: 12,
    discountPct: 0,
    startDate: '',
    lineItems: ['Platform license'],
  };
}

const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;

export function isIsoDate(value: string): boolean {
  const match = ISO_DATE.exec(value);
  if (!match) {
    return false;
  }
  const [year, month, day] = [Number(match[1]), Number(match[2]), Number(match[3])];
  const date = new Date(Date.UTC(year, month - 1, day));
  return (
    date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day
  );
}

export function isBillingDate(value: string): boolean {
  return isIsoDate(value) && value.endsWith('-01');
}
