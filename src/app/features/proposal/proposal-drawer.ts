import {
  Component,
  DestroyRef,
  afterNextRender,
  computed,
  effect,
  inject,
  linkedSignal,
  signal,
  untracked,
  viewChild,
  type ElementRef,
} from '@angular/core';
import { form, FormField, FormRoot, type FieldTree } from '@angular/forms/signals';
import { MatButton, MatIconButton } from '@angular/material/button';
import { MatFormField, MatLabel } from '@angular/material/form-field';
import { MatIcon } from '@angular/material/icon';
import { MatInput } from '@angular/material/input';
import {
  PRODUCT_TIERS,
  PROPOSAL_KEYS,
  STARTER_SEAT_LIMIT,
  createProposalModel,
  type ProposalDraft,
  type ProposalKey,
  type ProposalModel,
} from '../../core/models/proposal';
import { formatCompactCurrency, roundMoney } from '../../core/util/money';
import { HUMAN_APPROVAL_GATE, type ApprovalRequest } from '../../mcp/tooling/approval-gate';
import { requireApproval } from '../../mcp/tooling/with-human-approval';
import { DashboardUiStore } from '../dashboard/data/dashboard-ui-store';
import { DealsStore } from '../dashboard/data/deals-store';
import { DISCOUNT_APPROVAL_PCT } from '../dashboard/tools/risk-policy';
import { FieldErrors } from './field-errors';
import { PROPOSAL_TOOL_DESCRIPTION, PROPOSAL_TOOL_NAME, proposalSchema } from './proposal-form';
import { ProposalsStore } from './proposals-store';

export const AGENT_GLOW_MS = 1200;

const FIELD_LABELS: Readonly<Record<ProposalKey, string>> = {
  dealId: 'Deal ID',
  clientName: 'Client name',
  contactEmail: 'Contact email',
  productTier: 'Product tier',
  seats: 'Seats',
  termMonths: 'Term',
  discountPct: 'Discount',
  startDate: 'Start date',
  lineItems: 'Line items',
};

export interface ProposalProblem {
  label: string;
  message: string;
}

function sameValue(a: ProposalModel[ProposalKey], b: ProposalModel[ProposalKey]): boolean {
  return Array.isArray(a) && Array.isArray(b) ? a.join('\u0000') === b.join('\u0000') : a === b;
}

@Component({
  selector: 'app-proposal-drawer',
  imports: [
    FormField,
    FormRoot,
    MatButton,
    MatIconButton,
    MatFormField,
    MatIcon,
    MatInput,
    MatLabel,
    FieldErrors,
  ],
  templateUrl: './proposal-drawer.html',
  host: {
    class: 'glass fixed inset-y-0 right-0 z-40 flex w-full max-w-md flex-col shadow-2xl',
    '(keydown.escape)': 'close()',
    '(input)': 'noteUserEdit($event)',
    '(change)': 'noteUserEdit($event)',
  },
})
export class ProposalDrawer {
  private readonly deals = inject(DealsStore);
  private readonly ui = inject(DashboardUiStore);
  private readonly proposals = inject(ProposalsStore);
  private readonly gate = inject(HUMAN_APPROVAL_GATE, { optional: true });
  private readonly destroyRef = inject(DestroyRef);
  private readonly aborter = new AbortController();

  protected readonly tiers = PRODUCT_TIERS;
  protected readonly dealOptions = computed(() => this.deals.entities());
  protected readonly heading = viewChild.required<ElementRef<HTMLElement>>('heading');

  protected readonly model = linkedSignal<string | null, ProposalModel>({
    source: this.ui.proposalDealId,
    computation: (dealId) => createProposalModel(untracked(() => this.seedFor(dealId))),
  });

  protected readonly proposalForm: FieldTree<ProposalModel> = form(
    this.model,
    proposalSchema((dealId) => this.deals.entityMap()[dealId] !== undefined),
    {
      name: 'proposal',
      experimentalWebMcpTool: {
        name: PROPOSAL_TOOL_NAME,
        description: PROPOSAL_TOOL_DESCRIPTION,
        annotations: { consequentialHint: true },
      },
      submission: {
        action: async (field) => this.submitDraft(field),
        onInvalid: () => this.attempted.set(true),
      },
    },
  );

  protected readonly saved = linkedSignal<ProposalModel, ProposalDraft | null>({
    source: this.model,
    computation: () => null,
  });
  protected readonly attempted = linkedSignal<ProposalModel, boolean>({
    source: this.model,
    computation: () => false,
  });

  protected readonly problems = computed<ProposalProblem[]>(() =>
    this.attempted()
      ? this.proposalForm()
          .errorSummary()
          .map((error) => {
            const key = error.fieldTree().keyInParent();
            return {
              label: typeof key === 'number' ? `Line item ${key + 1}` : this.labelOf(key),
              message: error.message ?? error.kind,
            };
          })
      : [],
  );

  protected readonly filled = signal<ReadonlySet<ProposalKey>>(new Set());
  private previous = this.model();
  private readonly userEdits = new Set<ProposalKey>();
  private readonly timers = new Map<ProposalKey, ReturnType<typeof setTimeout>>();

  private readonly trackAgentFill = effect(() => {
    const next = this.model();
    const changed = PROPOSAL_KEYS.filter(
      (key) => !sameValue(this.previous[key], next[key]) && !this.userEdits.has(key),
    );
    this.userEdits.clear();
    this.previous = next;
    untracked(() => this.glow(changed));
  });

  constructor() {
    afterNextRender(() => this.heading().nativeElement.focus());
    this.destroyRef.onDestroy(() => {
      this.aborter.abort();
      this.timers.forEach((timer) => clearTimeout(timer));
    });
  }

  protected close(): void {
    this.ui.closeProposal();
  }

  protected noteUserEdit(event: Event): void {
    const key = (event.target as HTMLElement | null)?.dataset['field'] as ProposalKey | undefined;
    if (key) {
      this.userEdits.add(key);
    }
  }

  protected addLineItem(): void {
    this.userEdits.add('lineItems');
    this.model.update((model) => ({ ...model, lineItems: [...model.lineItems, ''] }));
  }

  protected removeLineItem(index: number): void {
    this.userEdits.add('lineItems');
    this.model.update((model) => ({
      ...model,
      lineItems: model.lineItems.filter((_, position) => position !== index),
    }));
  }

  private labelOf(key: string): string {
    return key in FIELD_LABELS ? FIELD_LABELS[key as ProposalKey] : key;
  }

  private seedFor(dealId: string | null) {
    const deal = dealId === null ? undefined : this.deals.entityMap()[dealId];
    return deal
      ? { dealId: deal.id, clientName: deal.account, contactEmail: deal.contactEmail }
      : {};
  }

  private async submitDraft(field: FieldTree<ProposalModel>) {
    this.attempted.set(true);
    const proposal = this.model();

    if (proposal.productTier === 'Starter' && proposal.seats > STARTER_SEAT_LIMIT) {
      return {
        kind: 'starter_seat_limit',
        message: `Starter supports at most ${STARTER_SEAT_LIMIT} seats; choose Growth or Enterprise`,
        fieldTree: field.seats,
      };
    }

    if (proposal.discountPct > DISCOUNT_APPROVAL_PCT) {
      const rejection = await requireApproval(
        this.gate,
        this.approvalRequest(proposal),
        this.aborter.signal,
      );
      if (rejection) {
        return {
          kind: 'approval_rejected',
          message: `A human rejected the ${proposal.discountPct}% discount${
            rejection.note ? `: ${rejection.note}` : ''
          }. Lower it to ${DISCOUNT_APPROVAL_PCT}% or less`,
          fieldTree: field.discountPct,
        };
      }
    }

    this.saved.set(this.proposals.saveDraft(proposal));
    return undefined;
  }

  private approvalRequest(proposal: ProposalModel): ApprovalRequest {
    const deal = this.deals.entityMap()[proposal.dealId];
    const discountValue = deal ? roundMoney((deal.listValue * proposal.discountPct) / 100) : 0;
    return {
      toolName: PROPOSAL_TOOL_NAME,
      risk: 'high',
      summary:
        `Save a ${proposal.termMonths}-month ${proposal.productTier} proposal for ` +
        `${proposal.clientName || proposal.dealId} with a ${proposal.discountPct}% discount`,
      policy: [
        `A discount of ${proposal.discountPct}% is above the ${DISCOUNT_APPROVAL_PCT}% approval threshold`,
      ],
      diff: [
        {
          label: `${proposal.clientName || 'Proposal'} (${proposal.dealId})`,
          field: 'Discount',
          before: deal ? `${deal.discountPct}%` : 'n/a',
          after: `${proposal.discountPct}%`,
          note: `${formatCompactCurrency(discountValue)} off list`,
        },
      ],
      details: proposal,
    };
  }

  private glow(keys: readonly ProposalKey[]): void {
    if (keys.length === 0) {
      return;
    }
    this.filled.update((current) => new Set([...current, ...keys]));
    for (const key of keys) {
      clearTimeout(this.timers.get(key));
      this.timers.set(
        key,
        setTimeout(() => {
          this.timers.delete(key);
          this.filled.update((current) => new Set([...current].filter((k) => k !== key)));
        }, AGENT_GLOW_MS),
      );
    }
  }
}
