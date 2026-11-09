import { computed, inject } from '@angular/core';
import { patchState, signalStore, withComputed, withMethods } from '@ngrx/signals';
import { addEntity, removeAllEntities, withEntities } from '@ngrx/signals/entities';
import type { ProposalDraft, ProposalModel } from '../../core/models/proposal';
import { CLOCK } from '../../core/util/clock';

export const ProposalsStore = signalStore(
  withEntities<ProposalDraft>(),
  withComputed(({ entities }) => ({
    latest: computed(() => entities().at(-1) ?? null),
  })),
  withMethods((store) => {
    const clock = inject(CLOCK);
    return {
      saveDraft(proposal: ProposalModel): ProposalDraft {
        const draft: ProposalDraft = {
          ...proposal,
          lineItems: [...proposal.lineItems],
          id: `P-${String(store.entities().length + 1).padStart(4, '0')}`,
          savedAt: clock().toISOString(),
        };
        patchState(store, addEntity(draft));
        return draft;
      },
      clearDrafts(): void {
        patchState(store, removeAllEntities());
      },
    };
  }),
);
