import { createSeedDeals } from '../app/core/data/seed-deals';
import type { Deal } from '../app/core/models/deal';
import type { ActId } from '../app/features/agent-console/demo-prompts';
import type { ProposalDraft } from '../app/core/models/proposal';
import type {
  DealsView,
  DecisionRecord,
  RunOutcome,
  ToolCallRecord,
} from '../app/features/lab/isolated-run';

export function seedDealsView(mutate: (deals: Deal[]) => void = () => undefined): DealsView {
  const deals = createSeedDeals();
  mutate(deals);
  return { deals, historyCount: 0 };
}

export function makeOutcome(overrides: Partial<RunOutcome> = {}): RunOutcome {
  return {
    runId: 'run-1',
    prompt: 'prompt',
    model: 'gemini-3.8-flash',
    events: [],
    text: '',
    toolCalls: [],
    decisions: [],
    error: null,
    stopped: false,
    usage: { input: 100, output: 20, thinking: 10 },
    costUsd: 0.002,
    ms: 1500,
    deals: seedDealsView(),
    proposals: { drafts: [] },
    ...overrides,
  };
}

export function toolCall(name: string, ok: boolean | null = true, index = 0): ToolCallRecord {
  return { callId: `call-${index}`, name, args: {}, ok, result: {}, latencyMs: 5 };
}

export function calls(...names: string[]): ToolCallRecord[] {
  return names.map((name, index) => toolCall(name, true, index));
}

export function decision(overrides: Partial<DecisionRecord> = {}): DecisionRecord {
  return {
    toolName: 'terminateContract',
    approved: false,
    scripted: true,
    callsBefore: 1,
    ...overrides,
  };
}

export function makeDraft(overrides: Partial<ProposalDraft> = {}): ProposalDraft {
  return {
    id: 'P-0001',
    savedAt: '2026-11-09T10:00:00.000Z',
    dealId: 'D-1001',
    clientName: 'Konkan Freight',
    contactEmail: 'procurement@konkan-freight.example',
    productTier: 'Enterprise',
    seats: 250,
    termMonths: 24,
    discountPct: 5,
    startDate: '2026-12-01',
    lineItems: ['Platform license'],
    ...overrides,
  };
}

export function act3FinalDeals(): DealsView {
  return seedDealsView((deals) => {
    const arcadia = deals.find((deal) => deal.account === 'Arcadia Bank');
    if (arcadia) {
      arcadia.discountPct = 25;
    }
  });
}

export function passingOutcome(actId: ActId, overrides: Partial<RunOutcome> = {}): RunOutcome {
  switch (actId) {
    case 'act1':
      return makeOutcome({ toolCalls: calls('getPipelineSummary'), ...overrides });
    case 'act2':
      return makeOutcome({
        toolCalls: calls('openProposalDrawer', 'draftDealProposal'),
        proposals: { drafts: [makeDraft()] },
        ...overrides,
      });
    case 'act3':
      return makeOutcome({
        toolCalls: calls('searchDeals', 'applyBatchDiscount', 'terminateContract'),
        decisions: [
          decision({ toolName: 'applyBatchDiscount', approved: true, callsBefore: 2 }),
          decision({ toolName: 'terminateContract', approved: false, callsBefore: 3 }),
        ],
        deals: act3FinalDeals(),
        ...overrides,
      });
  }
}
