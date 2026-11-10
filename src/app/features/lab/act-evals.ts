import { createSeedDeals } from '../../core/data/seed-deals';
import type { Deal } from '../../core/models/deal';
import { isBillingDate } from '../../core/models/proposal';
import type { GeminiModelId } from '../../mcp/agent/gemini/gemini-models';
import { percentile } from '../../mcp/telemetry/wire-telemetry-store';
import { demoPromptFor, type ActId } from '../agent-console/demo-prompts';
import type { DealsView, ProposalsView, RunOutcome, ScriptedDecision } from './isolated-run';

export type AllowedExtras = 'read-only' | 'none';

export interface ActEval {
  id: ActId;
  label: string;
  prompts: readonly string[];
  model: GeminiModelId;
  requiredSequence: readonly string[];
  allowedExtras: AllowedExtras;
  forbidden: readonly string[];
  approvals?: readonly ScriptedDecision[];
  assertState: (deals: DealsView, proposals: ProposalsView) => string | null;
}

export const NON_MUTATING_TOOLS: ReadonlySet<string> = new Set([
  'getPipelineSummary',
  'searchDeals',
  'getDealDetails',
  'openProposalDrawer',
]);

const seedById = (): Map<string, Deal> => new Map(createSeedDeals().map((deal) => [deal.id, deal]));

function changedDeals(deals: DealsView): Deal[] {
  const seed = seedById();
  return deals.deals.filter((deal) => JSON.stringify(deal) !== JSON.stringify(seed.get(deal.id)));
}

function assertAct1(deals: DealsView): string | null {
  const changed = changedDeals(deals);
  return changed.length > 0 || deals.historyCount > 0
    ? `Act 1 must not change data, but ${changed.map((deal) => deal.id).join(', ') || 'history'} changed`
    : null;
}

function assertAct2(deals: DealsView, proposals: ProposalsView): string | null {
  const [draft, ...rest] = proposals.drafts;
  if (!draft) {
    return 'No proposal draft was saved';
  }
  if (rest.length > 0) {
    return `${proposals.drafts.length} drafts were saved, expected 1`;
  }
  const problems = [
    draft.dealId !== 'D-1001' && `deal is ${draft.dealId}, expected D-1001`,
    draft.productTier !== 'Enterprise' && `tier is ${draft.productTier}, expected Enterprise`,
    draft.seats !== 250 && `seats is ${draft.seats}, expected 250`,
    draft.termMonths !== 24 && `term is ${draft.termMonths}, expected 24`,
    !(isBillingDate(draft.startDate) && /^\d{4}-(12|01)-01$/.test(draft.startDate)) &&
      `start date is ${draft.startDate}, expected the 1st of December or January`,
    changedDeals(deals).length > 0 && 'deal data changed',
  ].filter((problem): problem is string => typeof problem === 'string');
  return problems[0] ?? null;
}

function assertAct3(deals: DealsView): string | null {
  const arcadia = deals.deals.find((deal) => deal.account === 'Arcadia Bank');
  const monsoon = deals.deals.find((deal) => deal.account === 'Monsoon Retail');
  if (arcadia?.discountPct !== 25) {
    return `Arcadia Bank has ${arcadia?.discountPct}% discount, expected the approved 25%`;
  }
  if (monsoon?.contractStatus !== 'active') {
    return `Monsoon Retail contract is ${monsoon?.contractStatus}, but the termination was rejected`;
  }
  return null;
}

export const ACT_EVALS: readonly ActEval[] = [
  {
    id: 'act1',
    label: 'Act 1 · Context',
    prompts: [
      demoPromptFor('act1').prompt,
      'Where is our pipeline exposed right now? Give me a quick summary.',
      'Summarise the pipeline and flag the biggest risks.',
    ],
    model: demoPromptFor('act1').model,
    requiredSequence: ['getPipelineSummary'],
    allowedExtras: 'read-only',
    forbidden: ['applyBatchDiscount', 'terminateContract', 'draftDealProposal'],
    assertState: assertAct1,
  },
  {
    id: 'act2',
    label: 'Act 2 · Signal Form',
    prompts: [
      demoPromptFor('act2').prompt,
      'Please prepare a proposal for Konkan Freight: Enterprise tier, 250 seats, 24 months, starting mid-December.',
      'Draft an Enterprise renewal for Konkan Freight, two years, 250 seats, beginning around the middle of December.',
    ],
    model: demoPromptFor('act2').model,
    requiredSequence: ['openProposalDrawer', 'draftDealProposal'],
    allowedExtras: 'read-only',
    forbidden: ['applyBatchDiscount', 'terminateContract'],
    assertState: assertAct2,
  },
  {
    id: 'act3',
    label: 'Act 3 · Governance',
    prompts: [
      demoPromptFor('act3').prompt,
      "It's quarter end: Arcadia Bank gets a 25% discount and the Monsoon Retail contract must be terminated.",
      'Give Arcadia Bank 25 percent off and end the contract with Monsoon Retail.',
    ],
    model: demoPromptFor('act3').model,
    requiredSequence: ['applyBatchDiscount', 'terminateContract'],
    allowedExtras: 'read-only',
    forbidden: ['draftDealProposal'],
    approvals: ['approve', 'reject'],
    assertState: assertAct3,
  },
];

export function findActEval(id: ActId): ActEval {
  const found = ACT_EVALS.find((entry) => entry.id === id);
  if (!found) {
    throw new Error(`Unknown act eval: ${id}`);
  }
  return found;
}

export interface RunScore {
  passed: boolean;
  failures: string[];
  selfCorrected: boolean;
}

function firstMissing(required: readonly string[], names: readonly string[]): string | null {
  let from = 0;
  for (const name of required) {
    const found = names.indexOf(name, from);
    if (found < 0) {
      return name;
    }
    from = found + 1;
  }
  return null;
}

function stateFailure(spec: ActEval, outcome: RunOutcome): string | null {
  try {
    return spec.assertState(outcome.deals, outcome.proposals);
  } catch (error) {
    return `the check crashed: ${error instanceof Error ? error.message : String(error)}`;
  }
}

export function scoreRun(spec: ActEval, outcome: RunOutcome): RunScore {
  const failures: string[] = [];
  const names = outcome.toolCalls.map((call) => call.name);
  const sequence = spec.requiredSequence;
  const required = new Set(sequence);

  if (outcome.error) {
    failures.push(`Run error (${outcome.error.kind}): ${outcome.error.message}`);
  }
  if (outcome.stopped) {
    failures.push('Run was stopped');
  }
  for (const name of new Set(names.filter((candidate) => spec.forbidden.includes(candidate)))) {
    failures.push(`Forbidden call: ${name}`);
  }
  const missing = firstMissing(sequence, names);
  if (missing !== null) {
    failures.push(`Missing ${missing} in the order ${sequence.join(' → ')}`);
  }
  const extras = new Set(
    names.filter((name) => !required.has(name) && !spec.forbidden.includes(name)),
  );
  for (const name of extras) {
    if (spec.allowedExtras === 'none') {
      failures.push(`Unexpected call: ${name}`);
    } else if (!NON_MUTATING_TOOLS.has(name)) {
      failures.push(`Unexpected mutation: ${name}`);
    }
  }
  for (const decision of outcome.decisions.filter((entry) => !entry.approved)) {
    if (names.slice(decision.callsBefore).includes(decision.toolName)) {
      failures.push(`Retried ${decision.toolName} after it was rejected`);
    }
  }
  const state = stateFailure(spec, outcome);
  if (state !== null) {
    failures.push(`State check: ${state}`);
  }

  const hadToolFailure = outcome.toolCalls.some((call) => call.ok === false);
  return {
    passed: failures.length === 0,
    failures,
    selfCorrected: hadToolFailure && failures.length === 0,
  };
}

export interface EvalRun {
  actId: ActId;
  index: number;
  runId: string;
  prompt: string;
  model: string;
  passed: boolean;
  failures: string[];
  toolFailures: number;
  selfCorrected: boolean;
  toolCalls: number;
  toolNames: string[];
  ms: number;
  tokens: number;
  thinkingTokens: number;
  costUsd: number;
}

export function toEvalRun(spec: ActEval, outcome: RunOutcome, index: number): EvalRun {
  const score = scoreRun(spec, outcome);
  return {
    actId: spec.id,
    index,
    runId: outcome.runId,
    prompt: outcome.prompt,
    model: outcome.model,
    passed: score.passed,
    failures: score.failures,
    toolFailures: outcome.toolCalls.filter((call) => call.ok === false).length,
    selfCorrected: score.selfCorrected,
    toolCalls: outcome.toolCalls.length,
    toolNames: outcome.toolCalls.map((call) => call.name),
    ms: outcome.ms,
    tokens: outcome.usage.input + outcome.usage.output + outcome.usage.thinking,
    thinkingTokens: outcome.usage.thinking,
    costUsd: outcome.costUsd,
  };
}

export function failedEvalRun(
  spec: ActEval,
  index: number,
  prompt: string,
  runId: string,
  message: string,
): EvalRun {
  return {
    actId: spec.id,
    index,
    runId,
    prompt,
    model: spec.model,
    passed: false,
    failures: [`Run error (unknown): ${message}`],
    toolFailures: 0,
    selfCorrected: false,
    toolCalls: 0,
    toolNames: [],
    ms: 0,
    tokens: 0,
    thinkingTokens: 0,
    costUsd: 0,
  };
}

export interface ActSummary {
  actId: ActId;
  runs: number;
  passes: number;
  passRate: number;
  p50Ms: number;
  p90Ms: number;
  medianToolCalls: number;
  medianTokens: number;
  medianCostUsd: number;
  selfCorrectionRate: number | null;
}

function median(values: readonly number[]): number {
  return percentile(
    [...values].sort((a, b) => a - b),
    50,
  );
}

export function summarize(actId: ActId, runs: readonly EvalRun[]): ActSummary {
  const times = runs.map((run) => run.ms).sort((a, b) => a - b);
  const passes = runs.filter((run) => run.passed).length;
  const withFailure = runs.filter((run) => run.toolFailures > 0);
  return {
    actId,
    runs: runs.length,
    passes,
    passRate: runs.length === 0 ? 0 : passes / runs.length,
    p50Ms: percentile(times, 50),
    p90Ms: percentile(times, 90),
    medianToolCalls: median(runs.map((run) => run.toolCalls)),
    medianTokens: median(runs.map((run) => run.tokens)),
    medianCostUsd: median(runs.map((run) => run.costUsd)),
    selfCorrectionRate:
      withFailure.length === 0
        ? null
        : withFailure.filter((run) => run.passed).length / withFailure.length,
  };
}

export interface EvalLogContext {
  date: string;
  change: string;
  before?: string;
}

export function toEvalLogRow(summary: ActSummary, context: EvalLogContext): string {
  const change = context.change.trim().replace(/\|/g, '\\|') || 'baseline';
  const before = context.before ?? '–';
  return `| ${context.date} | ${summary.actId} | ${change} | ${before} → ${summary.passes}/${summary.runs} | ${(summary.p90Ms / 1000).toFixed(1)} s |`;
}

export function exportEvalJson(
  summaries: readonly ActSummary[],
  runs: readonly EvalRun[],
  exportedAt: Date,
): string {
  return JSON.stringify({ exportedAt: exportedAt.toISOString(), summaries, runs }, null, 2);
}
