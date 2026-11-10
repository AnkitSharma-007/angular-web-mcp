import { computed } from '@angular/core';
import {
  patchState,
  signalStoreFeature,
  withComputed,
  withMethods,
  withState,
} from '@ngrx/signals';
import { setAllEntities, updateEntity, withEntities } from '@ngrx/signals/entities';
import { createSeedDeals } from '../../../core/data/seed-deals';
import {
  MAX_DISCOUNT_PCT,
  isAtRisk,
  type ContractStatus,
  type Deal,
} from '../../../core/models/deal';
import type { MutationResult } from '../../../core/models/mutation-result';
import {
  matchesQuery,
  byRegion,
  byStage,
  computeKpis,
  searchDeals,
  type DealSearch,
} from './deal-analytics';

interface QueryState {
  query: string;
}

export function clampDiscount(discountPct: number): number {
  return Math.min(MAX_DISCOUNT_PCT, Math.max(0, discountPct));
}

export function withDeals() {
  return signalStoreFeature(
    withEntities<Deal>(),
    withState<QueryState>({ query: '' }),
    withComputed(({ entities, query }) => ({
      filteredDeals: computed(() => entities().filter((deal) => matchesQuery(deal, query()))),
      pipelineByStage: computed(() => byStage(entities())),
      byRegion: computed(() => byRegion(entities())),
      kpis: computed(() => computeKpis(entities())),
      atRiskDeals: computed(() => entities().filter(isAtRisk)),
    })),
    withMethods((store) => ({
      setQuery(query: string): void {
        patchState(store, { query });
      },
      search(criteria: DealSearch = {}) {
        return searchDeals(store.entities(), criteria);
      },
      applyDiscount(dealIds: readonly string[], discountPct: number): MutationResult<number> {
        const after = clampDiscount(discountPct);
        const result: MutationResult<number> = { changed: [], skipped: [] };
        for (const id of dealIds) {
          const deal = store.entityMap()[id];
          if (!deal) {
            result.skipped.push({ id, why: 'unknown deal' });
          } else if (deal.discountPct === after) {
            result.skipped.push({ id, why: `already at ${after}%` });
          } else {
            result.changed.push({ id, before: deal.discountPct, after });
          }
        }
        patchState(
          store,
          ...result.changed.map(({ id, after: pct }) =>
            updateEntity<Deal>({ id, changes: { discountPct: pct } }),
          ),
        );
        return result;
      },
      terminateContract(dealId: string): MutationResult<ContractStatus> {
        const deal = store.entityMap()[dealId];
        const result: MutationResult<ContractStatus> = { changed: [], skipped: [] };
        if (!deal) {
          result.skipped.push({ id: dealId, why: 'unknown deal' });
        } else if (deal.stage !== 'closed-won') {
          result.skipped.push({ id: dealId, why: 'only closed-won deals have a contract' });
        } else if (deal.contractStatus !== 'active') {
          result.skipped.push({ id: dealId, why: 'contract is not active' });
        } else {
          result.changed.push({ id: dealId, before: 'active', after: 'terminated' });
          patchState(
            store,
            updateEntity<Deal>({ id: dealId, changes: { contractStatus: 'terminated' } }),
          );
        }
        return result;
      },
      reset(): void {
        patchState(store, setAllEntities(createSeedDeals()), { query: '' });
      },
    })),
  );
}
