import { inject, linkedSignal } from '@angular/core';
import { patchState, signalStore, withLinkedState, withMethods, withState } from '@ngrx/signals';
import type { Deal } from '../../../core/models/deal';
import { DealsStore } from './deals-store';

export const DashboardUiStore = signalStore(
  withState({ proposalOpen: false }),
  withLinkedState(() => ({
    selectedDealId: linkedSignal<readonly Deal[], string | null>({
      source: inject(DealsStore).filteredDeals,
      computation: (visible, previous) =>
        previous && visible.some((deal) => deal.id === previous.value) ? previous.value : null,
    }),
  })),
  withMethods((store) => ({
    selectDeal(dealId: string | null): void {
      patchState(store, { selectedDealId: dealId });
    },
    openProposal(): void {
      patchState(store, { proposalOpen: true });
    },
    closeProposal(): void {
      patchState(store, { proposalOpen: false });
    },
  })),
);
