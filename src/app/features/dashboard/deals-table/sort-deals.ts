import type { Sort } from '@angular/material/sort';
import { DEAL_STAGES, type Deal } from '../../../core/models/deal';
import { netValue } from '../../../core/util/money';

type SortValue = string | number;

const ACCESSORS: Readonly<Record<string, (deal: Deal) => SortValue>> = {
  account: (deal) => deal.account.toLowerCase(),
  owner: (deal) => deal.owner.toLowerCase(),
  region: (deal) => deal.region,
  stage: (deal) => DEAL_STAGES.indexOf(deal.stage),
  netValue: (deal) => netValue(deal),
  discountPct: (deal) => deal.discountPct,
  probability: (deal) => deal.probability,
  closeDate: (deal) => deal.closeDate,
  lastActivityDays: (deal) => deal.lastActivityDays,
};

export function sortDeals(deals: readonly Deal[], sort: Sort): Deal[] {
  const accessor = ACCESSORS[sort.active];
  if (!accessor || sort.direction === '') {
    return [...deals];
  }
  const sign = sort.direction === 'asc' ? 1 : -1;
  return [...deals].sort((a, b) => {
    const left = accessor(a);
    const right = accessor(b);
    return left < right ? -sign : left > right ? sign : a.id.localeCompare(b.id);
  });
}
