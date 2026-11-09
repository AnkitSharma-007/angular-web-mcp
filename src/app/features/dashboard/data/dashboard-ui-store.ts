import { inject, linkedSignal } from '@angular/core';
import {
  patchState,
  signalStore,
  withFeature,
  withLinkedState,
  withMethods,
  withProps,
  withState,
} from '@ngrx/signals';
import type { Deal } from '../../../core/models/deal';
import { withWebMcpTools } from '../../../mcp/store-features/with-webmcp-tools';
import { dashboardUiTools } from '../tools/ui-tools';
import { DealsStore } from './deals-store';

export const DashboardUiStore = signalStore(
  withState<{ proposalOpen: boolean; proposalDealId: string | null }>({
    proposalOpen: false,
    proposalDealId: null,
  }),
  withProps(() => ({ _deals: inject(DealsStore) })),
  withLinkedState(({ _deals }) => ({
    selectedDealId: linkedSignal<readonly Deal[], string | null>({
      source: _deals.filteredDeals,
      computation: (visible, previous) =>
        previous && visible.some((deal) => deal.id === previous.value) ? previous.value : null,
    }),
  })),
  withMethods((store) => ({
    selectDeal(dealId: string | null): void {
      patchState(store, { selectedDealId: dealId });
    },
    openProposal(dealId?: string): void {
      patchState(store, (state) => ({
        proposalOpen: true,
        proposalDealId: dealId ?? state.proposalDealId,
      }));
    },
    closeProposal(): void {
      patchState(store, { proposalOpen: false, proposalDealId: null });
    },
  })),
  withFeature((store) => withWebMcpTools(() => dashboardUiTools(store, store._deals))),
);
