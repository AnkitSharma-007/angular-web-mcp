import {
  DEAL_STAGES,
  REGIONS,
  isOpen,
  isStalled,
  type Deal,
  type DealFilter,
  type DealStage,
  type Region,
} from '../../../core/models/deal';
import { netValue, roundMoney } from '../../../core/util/money';

export interface Breakdown<K extends string> {
  key: K;
  count: number;
  netValue: number;
  pct: number;
}

export interface Kpis {
  openDeals: number;
  openValue: number;
  weightedForecast: number;
  wonValue: number;
  winRate: number;
  stalledCount: number;
}

export interface DealSearch {
  stages?: readonly DealStage[];
  regions?: readonly Region[];
  minValue?: number;
  maxValue?: number;
  minProbability?: number;
  stalledOnly?: boolean;
  query?: string;
  limit?: number;
}

export interface DealSearchResult {
  total: number;
  deals: Deal[];
}

export const DEFAULT_SEARCH_LIMIT = 25;

export function matchesQuery(deal: Deal, query: string): boolean {
  const needle = query.trim().toLowerCase();
  return (
    needle === '' ||
    [deal.id, deal.account, deal.title, deal.owner].some((field) =>
      field.toLowerCase().includes(needle),
    )
  );
}

export function applyFilter(deals: readonly Deal[], filter: DealFilter): Deal[] {
  return deals.filter(
    (deal) =>
      (filter.stages.length === 0 || filter.stages.includes(deal.stage)) &&
      (filter.regions.length === 0 || filter.regions.includes(deal.region)) &&
      (filter.minValue === null || netValue(deal) >= filter.minValue) &&
      matchesQuery(deal, filter.query),
  );
}

export function searchDeals(deals: readonly Deal[], criteria: DealSearch = {}): DealSearchResult {
  const matches = deals
    .filter(
      (deal) =>
        (!criteria.stages?.length || criteria.stages.includes(deal.stage)) &&
        (!criteria.regions?.length || criteria.regions.includes(deal.region)) &&
        (criteria.minValue === undefined || netValue(deal) >= criteria.minValue) &&
        (criteria.maxValue === undefined || netValue(deal) <= criteria.maxValue) &&
        (criteria.minProbability === undefined || deal.probability >= criteria.minProbability) &&
        (!criteria.stalledOnly || isStalled(deal)) &&
        matchesQuery(deal, criteria.query ?? ''),
    )
    .sort((a, b) => netValue(b) - netValue(a) || a.id.localeCompare(b.id));
  return {
    total: matches.length,
    deals: matches.slice(0, criteria.limit ?? DEFAULT_SEARCH_LIMIT),
  };
}

function breakdown<K extends string>(
  deals: readonly Deal[],
  keys: readonly K[],
  keyOf: (deal: Deal) => K,
): Breakdown<K>[] {
  const total = deals.reduce((sum, deal) => sum + netValue(deal), 0);
  return keys.map((key) => {
    const group = deals.filter((deal) => keyOf(deal) === key);
    const value = roundMoney(group.reduce((sum, deal) => sum + netValue(deal), 0));
    return {
      key,
      count: group.length,
      netValue: value,
      pct: total === 0 ? 0 : Math.round((value / total) * 1000) / 10,
    };
  });
}

export function byStage(deals: readonly Deal[]): Breakdown<DealStage>[] {
  return breakdown(deals, DEAL_STAGES, (deal) => deal.stage);
}

export function byRegion(deals: readonly Deal[]): Breakdown<Region>[] {
  return breakdown(deals, REGIONS, (deal) => deal.region);
}

export function computeKpis(deals: readonly Deal[]): Kpis {
  const open = deals.filter(isOpen);
  const won = deals.filter((deal) => deal.stage === 'closed-won');
  const lost = deals.filter((deal) => deal.stage === 'closed-lost');
  const closedCount = won.length + lost.length;
  const sum = (items: readonly Deal[], weight: (deal: Deal) => number) =>
    roundMoney(items.reduce((total, deal) => total + weight(deal), 0));
  return {
    openDeals: open.length,
    openValue: sum(open, netValue),
    weightedForecast: sum(open, (deal) => (netValue(deal) * deal.probability) / 100),
    wonValue: sum(won, netValue),
    winRate: closedCount === 0 ? 0 : Math.round((won.length / closedCount) * 1000) / 10,
    stalledCount: open.filter(isStalled).length,
  };
}
