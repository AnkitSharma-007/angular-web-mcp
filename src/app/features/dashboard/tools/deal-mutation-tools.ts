import { inject, type Signal, type WebMcpToolDescriptor } from '@angular/core';
import type { ContractStatus, Deal } from '../../../core/models/deal';
import type { MutationResult } from '../../../core/models/mutation-result';
import type { HistoryEntry } from '../../../core/store-features/with-agent-history';
import { formatCompactCurrency, netValue, roundMoney } from '../../../core/util/money';
import type { ApprovalRequest } from '../../../mcp/tooling/approval-gate';
import { defineTool, type ToolContext } from '../../../mcp/tooling/define-tool';
import { ToolInputError } from '../../../mcp/tooling/tool-errors';
import { UndoNotifier } from '../../history/undo-notifier';
import { assessDiscount, discountImpact } from './risk-policy';

export interface DealMutationStore {
  readonly entityMap: Signal<Readonly<Record<string, Deal | undefined>>>;
  applyDiscount(dealIds: readonly string[], discountPct: number): MutationResult<number>;
  terminateContract(dealId: string): MutationResult<ContractStatus>;
  recordSnapshot(label: string): string;
  undoTo(id: string): HistoryEntry | null;
}

type Outcome = 'applied' | 'partial' | 'no_change';

const DEAL_ID = { type: 'string', pattern: '^D-\\d{4}$' } as const;
const REASON = {
  type: 'string',
  minLength: 3,
  maxLength: 200,
  description:
    'Why this change is being made. Shown to the human in the approval dialog and recorded in the wire log',
} as const;

function outcome(changed: number, skipped: number): Outcome {
  if (changed === 0) {
    return 'no_change';
  }
  return skipped === 0 ? 'applied' : 'partial';
}

function plural(count: number, noun: string): string {
  return `${count} ${noun}${count === 1 ? '' : 's'}`;
}

function unique<T>(items: readonly T[]): T[] {
  return [...new Set(items)];
}

interface DiscountArgs {
  dealIds: string[];
  discountPct: number;
  reason: string;
}

interface TerminateArgs {
  dealId: string;
  reason: string;
}

export function dealMutationTools(store: DealMutationStore): WebMcpToolDescriptor[] {
  const undoer = ({ snapshotId }: ToolContext) =>
    snapshotId === undefined ? undefined : () => store.undoTo(snapshotId);

  const applyBatchDiscount = defineTool<DiscountArgs, UndoNotifier>({
    name: 'applyBatchDiscount',
    title: 'Apply batch discount',
    description:
      "Use to set the same discount percentage on up to 25 deals at once. Replaces each deal's " +
      'current discount, it does not add to it. Needs exact IDs from searchDeals. Discounts ' +
      'above 15% or with a revenue impact above $250k need human approval, and the human may ' +
      'reject: then nothing changes and you get status "rejected_by_human". Returns the ' +
      'before/after for each changed deal and the net revenue impact (negative is revenue lost).',
    inputSchema: {
      type: 'object',
      additionalProperties: false,
      required: ['dealIds', 'discountPct', 'reason'],
      properties: {
        dealIds: { type: 'array', items: DEAL_ID, minItems: 1, maxItems: 25 },
        discountPct: { type: 'number', minimum: 0, maximum: 50, description: 'Percent, 0-50' },
        reason: REASON,
      },
    },
    annotations: { consequentialHint: true },
    deps: () => inject(UndoNotifier),
    risk: ({ dealIds, discountPct, reason }): ApprovalRequest | null => {
      const ids = unique(dealIds);
      const assessment = assessDiscount(
        ids.map((id) => store.entityMap()[id]),
        discountPct,
      );
      return assessment.flags.length === 0
        ? null
        : {
            toolName: 'applyBatchDiscount',
            risk: 'high',
            summary:
              `Set a ${discountPct}% discount on ${plural(ids.length, 'deal')} ` +
              `(${formatCompactCurrency(assessment.revenueImpact)} revenue)`,
            reason,
            policy: assessment.flags,
            diff: assessment.changes.map((change) => ({
              label: `${change.account} (${change.id})`,
              field: 'Discount',
              before: `${change.before}%`,
              after: `${change.after}%`,
              note: formatCompactCurrency(change.impact),
            })),
            details: { policy: assessment.flags, changes: assessment.changes },
          };
    },
    snapshot: store,
    snapshotLabel: ({ dealIds, discountPct }) =>
      `${discountPct}% discount on ${plural(unique(dealIds).length, 'deal')}`,
    run: ({ dealIds, discountPct }, ctx, notifier) => {
      const { changed, skipped } = store.applyDiscount(unique(dealIds), discountPct);
      const revenueImpact = roundMoney(
        changed.reduce(
          (sum, { id, before, after }) =>
            sum + discountImpact(store.entityMap()[id]?.listValue ?? 0, before, after),
          0,
        ),
      );
      if (changed.length > 0) {
        notifier.announce(
          `Agent set a ${discountPct}% discount on ${plural(changed.length, 'deal')}`,
          undoer(ctx),
        );
      }
      return { status: outcome(changed.length, skipped.length), changed, skipped, revenueImpact };
    },
  });

  const terminateContract = defineTool<TerminateArgs, UndoNotifier>({
    name: 'terminateContract',
    title: 'Terminate contract',
    description:
      'Use only when the user explicitly asks to end a customer contract. Works on closed-won ' +
      'deals with an active contract. This is irreversible for the agent and ALWAYS needs human ' +
      'approval: the human may reject, then nothing changes and you get status ' +
      '"rejected_by_human" with their note. Needs an exact ID from searchDeals.',
    inputSchema: {
      type: 'object',
      additionalProperties: false,
      required: ['dealId', 'reason'],
      properties: { dealId: DEAL_ID, reason: REASON },
    },
    annotations: { consequentialHint: true },
    deps: () => inject(UndoNotifier),
    risk: ({ dealId, reason }): ApprovalRequest => {
      const deal = store.entityMap()[dealId];
      if (!deal) {
        throw new ToolInputError(`Unknown deal ${dealId}. Use searchDeals to find valid deal IDs.`);
      }
      const policy = ['Terminating a contract always needs a human decision'];
      return {
        toolName: 'terminateContract',
        risk: 'critical',
        summary: `Terminate the contract with ${deal.account} (${deal.id})`,
        reason,
        policy,
        diff: [
          {
            label: `${deal.account} (${deal.id})`,
            field: 'Contract',
            before: deal.contractStatus,
            after: 'terminated',
            note: `${formatCompactCurrency(netValue(deal))} net value`,
          },
        ],
        details: { policy, contact: deal.contactEmail },
      };
    },
    snapshot: store,
    snapshotLabel: ({ dealId }) => `Terminate contract ${dealId}`,
    run: ({ dealId }, ctx, notifier) => {
      const { changed, skipped } = store.terminateContract(dealId);
      if (changed.length > 0) {
        notifier.announce(`Agent terminated the contract for ${dealId}`, undoer(ctx));
      }
      return {
        status: outcome(changed.length, skipped.length),
        dealId,
        terminatedAt: changed.length > 0 ? ctx.now().toISOString() : null,
        skipped,
      };
    },
  });

  return [applyBatchDiscount, terminateContract];
}
