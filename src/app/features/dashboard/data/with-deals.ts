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
  EMPTY_FILTER,
  MAX_DISCOUNT_PCT,
  isAtRisk,
  isClosedStage,
  type ContractStatus,
  type Deal,
  type DealFilter,
  type DealStage,
} from '../../../core/models/deal';
import type { MutationResult } from '../../../core/models/mutation-result';
import {
  applyFilter,
  byRegion,
  byStage,
  computeKpis,
  searchDeals,
  type DealSearch,
} from './deal-analytics';

export interface StageUpdate {
  dealId: string;
  stage: DealStage;
}

interface FilterState {
  filter: DealFilter;
}

export function clampDiscount(discountPct: number): number {
  return Math.min(MAX_DISCOUNT_PCT, Math.max(0, discountPct));
}

export function withDeals() {
  return signalStoreFeature(
    withEntities<Deal>(),
    withState<FilterState>({ filter: { ...EMPTY_FILTER } }),
    withComputed(({ entities, filter }) => ({
      filteredDeals: computed(() => applyFilter(entities(), filter())),
      pipelineByStage: computed(() => byStage(entities())),
      byRegion: computed(() => byRegion(entities())),
      kpis: computed(() => computeKpis(entities())),
      atRiskDeals: computed(() => entities().filter(isAtRisk)),
    })),
    withMethods((store) => ({
      setFilter(partial: Partial<DealFilter>): void {
        patchState(store, (state) => ({ filter: { ...state.filter, ...partial } }));
      },
      clearFilter(): void {
        patchState(store, { filter: { ...EMPTY_FILTER } });
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
      moveStages(updates: readonly StageUpdate[]): MutationResult<DealStage> {
        const result: MutationResult<DealStage> = { changed: [], skipped: [] };
        const changes: { id: string; changes: Partial<Deal> }[] = [];
        for (const { dealId: id, stage } of updates) {
          const deal = store.entityMap()[id];
          if (!deal) {
            result.skipped.push({ id, why: 'unknown deal' });
          } else if (isClosedStage(deal.stage)) {
            result.skipped.push({ id, why: 'closed deals cannot be reopened' });
          } else if (deal.stage === stage) {
            result.skipped.push({ id, why: `already in ${stage}` });
          } else {
            result.changed.push({ id, before: deal.stage, after: stage });
            changes.push({ id, changes: closeOutChanges(stage) });
          }
        }
        patchState(store, ...changes.map((change) => updateEntity<Deal>(change)));
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
        patchState(store, setAllEntities(createSeedDeals()), { filter: { ...EMPTY_FILTER } });
      },
    })),
  );
}

function closeOutChanges(stage: DealStage): Partial<Deal> {
  switch (stage) {
    case 'closed-won':
      return { stage, probability: 100, contractStatus: 'active' };
    case 'closed-lost':
      return { stage, probability: 0 };
    default:
      return { stage };
  }
}
