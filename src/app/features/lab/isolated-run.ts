import { DestroyRef, Service, computed, inject, injectAsync, signal } from '@angular/core';
import type { Deal } from '../../core/models/deal';
import type { ProposalDraft } from '../../core/models/proposal';
import { CLOCK } from '../../core/util/clock';
import type { AgentErrorKind, AgentEvent } from '../../mcp/agent/agent-events';
import { WireTelemetryStore } from '../../mcp/telemetry/wire-telemetry-store';
import type { TokenUsage } from '../../mcp/telemetry/wire-packet';
import type { ApprovalDecision, ApprovalRequest } from '../../mcp/tooling/approval-gate';
import { PresenterActions } from '../agent-console/presenter-actions';
import { ApprovalService } from '../approvals/approval-service';
import { DashboardUiStore } from '../dashboard/data/dashboard-ui-store';
import { DealsStore } from '../dashboard/data/deals-store';
import { ProposalsStore } from '../proposal/proposals-store';

export type ScriptedDecision = 'approve' | 'reject';

export interface ToolCallRecord {
  callId: string;
  name: string;
  args: unknown;
  ok: boolean | null;
  result: unknown;
  latencyMs: number | null;
}

export interface DecisionRecord {
  toolName: string;
  approved: boolean;
  scripted: boolean;
  callsBefore: number;
}

export interface DealsView {
  deals: readonly Deal[];
  historyCount: number;
}

export interface ProposalsView {
  drafts: readonly ProposalDraft[];
}

export interface RunFailure {
  kind: AgentErrorKind;
  message: string;
}

export interface RunOutcome {
  runId: string;
  prompt: string;
  model: string;
  events: AgentEvent[];
  text: string;
  toolCalls: ToolCallRecord[];
  decisions: DecisionRecord[];
  error: RunFailure | null;
  stopped: boolean;
  usage: TokenUsage;
  costUsd: number;
  ms: number;
  deals: DealsView;
  proposals: ProposalsView;
}

export interface IsolatedRunOptions {
  prompt: string;
  model: string;
  approvals?: readonly ScriptedDecision[];
  runId?: string;
  signal?: AbortSignal;
  maxSteps?: number;
  fromSeed?: boolean;
  maxRunMs?: number;
}

export const RUN_BUDGET_MS = 120_000;

const NO_USAGE: TokenUsage = { input: 0, output: 0, thinking: 0 };

/** Runs one agent prompt against the live dashboard stores (or the seed, with `fromSeed`), then puts every store back exactly as it was. */
@Service({ autoProvided: false })
export class IsolatedRunner {
  private readonly deals = inject(DealsStore);
  private readonly proposals = inject(ProposalsStore);
  private readonly ui = inject(DashboardUiStore);
  private readonly approvals = inject(ApprovalService);
  private readonly telemetry = inject(WireTelemetryStore);
  private readonly clock = inject(CLOCK);
  private readonly loadAgent = injectAsync(() =>
    import('../../mcp/agent/gemini/gemini-agent').then((m) => m.GeminiAgent),
  );

  private readonly holds = signal(0);
  private readonly runId = signal<string | null>(null);
  private tail: Promise<unknown> = Promise.resolve();
  private sequence = 0;
  private epoch = 0;
  private lifecycle = new AbortController();

  constructor() {
    const unregister = inject(PresenterActions).registerReset(() => this.interrupt(true));
    inject(DestroyRef).onDestroy(() => {
      unregister();
      this.interrupt(false);
    });
  }

  readonly evalMode = computed(() => this.holds() > 0);
  readonly activeRunId = this.runId.asReadonly();

  /** Keeps eval mode on across a series of runs, until the returned function is called. */
  beginBatch(): () => void {
    this.holds.update((count) => count + 1);
    let released = false;
    return () => {
      if (!released) {
        released = true;
        this.holds.update((count) => count - 1);
      }
    };
  }

  run(options: IsolatedRunOptions): Promise<RunOutcome> {
    const release = this.beginBatch();
    const result = this.tail.then(() => this.execute(options));
    this.tail = result.catch(() => undefined);
    return result.finally(release);
  }

  private async execute(options: IsolatedRunOptions): Promise<RunOutcome> {
    const runId = options.runId ?? `run-${++this.sequence}`;
    const epoch = this.epoch;
    const lifecycle = this.lifecycle.signal;
    const budget = new AbortController();
    const budgetMs = options.maxRunMs ?? RUN_BUDGET_MS;
    let timedOut = false;
    const budgetTimer = setTimeout(() => {
      timedOut = true;
      budget.abort();
    }, budgetMs);
    const signal = AbortSignal.any(
      options.signal ? [options.signal, lifecycle, budget.signal] : [lifecycle, budget.signal],
    );
    const baseline = {
      deals: this.deals.snapshotState(),
      proposals: this.proposals.snapshotState(),
      ui: this.ui.snapshotState(),
    };
    if (options.fromSeed) {
      this.seed();
    }
    const script = [...(options.approvals ?? [])];
    const decisions: DecisionRecord[] = [];
    const toolCalls: ToolCallRecord[] = [];
    const events: AgentEvent[] = [];
    const outcome = {
      text: '',
      error: null as RunFailure | null,
      usage: NO_USAGE,
      costUsd: 0,
      ms: null as number | null,
    };
    const startedAt = this.clock().getTime();

    this.approvals.setAutoDecider((request) => {
      const scripted = script.shift();
      decisions.push({
        toolName: request.toolName,
        approved: scripted === 'approve',
        scripted: scripted !== undefined,
        callsBefore: toolCalls.length,
      });
      return decide(request, scripted);
    });
    this.telemetry.setActiveRun(runId);
    this.runId.set(runId);

    try {
      try {
        const agent = await this.loadAgent();
        const stream = agent.run(options.prompt, {
          signal,
          model: options.model,
          runId,
          ...(options.maxSteps !== undefined && { maxSteps: options.maxSteps }),
        });
        for await (const event of stream) {
          events.push(event);
          fold(event, toolCalls, outcome);
        }
      } catch (error) {
        outcome.error = {
          kind: 'unknown',
          message: error instanceof Error ? error.message : String(error),
        };
      }
      if (timedOut && outcome.error === null) {
        outcome.error = {
          kind: 'unknown',
          message: `The run exceeded its ${Math.round(budgetMs / 1000)}s budget and was stopped`,
        };
      }
      return {
        runId,
        prompt: options.prompt,
        model: options.model,
        events,
        text: outcome.text,
        toolCalls,
        decisions,
        error: outcome.error,
        stopped: signal.aborted,
        usage: outcome.usage,
        costUsd: outcome.costUsd,
        ms: outcome.ms ?? this.clock().getTime() - startedAt,
        deals: this.viewDeals(),
        proposals: this.viewProposals(),
      };
    } finally {
      clearTimeout(budgetTimer);
      if (this.epoch === epoch) {
        this.deals.restoreState(baseline.deals);
        this.proposals.restoreState(baseline.proposals);
        this.ui.restoreState(baseline.ui);
      } else {
        this.seed();
      }
      this.approvals.setAutoDecider(null);
      this.telemetry.setActiveRun(null);
      this.runId.set(null);
    }
  }

  /** Stops every active run; after a presenter reset the stores end at the seed, not at a stale snapshot. */
  private interrupt(reset: boolean): void {
    if (reset) {
      this.epoch++;
    }
    this.lifecycle.abort();
    this.lifecycle = new AbortController();
  }

  private seed(): void {
    this.ui.closeProposal();
    this.ui.selectDeal(null);
    this.deals.reset();
    this.deals.clearHistory();
    this.proposals.clearDrafts();
  }

  private viewDeals(): DealsView {
    return {
      deals: this.deals.entities().map((deal) => ({ ...deal })),
      historyCount: this.deals.history().length,
    };
  }

  private viewProposals(): ProposalsView {
    return {
      drafts: this.proposals.entities().map((draft) => ({
        ...draft,
        lineItems: [...draft.lineItems],
      })),
    };
  }
}

function decide(
  request: ApprovalRequest,
  scripted: ScriptedDecision | undefined,
): ApprovalDecision {
  if (scripted === 'approve') {
    return { approved: true, note: `scripted approval of ${request.toolName}` };
  }
  return {
    approved: false,
    note: scripted === 'reject' ? 'scripted rejection' : 'no scripted decision',
  };
}

function fold(
  event: AgentEvent,
  toolCalls: ToolCallRecord[],
  outcome: {
    text: string;
    error: RunFailure | null;
    usage: TokenUsage;
    costUsd: number;
    ms: number | null;
  },
): void {
  switch (event.type) {
    case 'text-delta':
      outcome.text += event.text;
      break;
    case 'tool-call':
      toolCalls.push({
        callId: event.callId,
        name: event.name,
        args: event.args,
        ok: null,
        result: null,
        latencyMs: null,
      });
      break;
    case 'tool-result': {
      const call = toolCalls.find((candidate) => candidate.callId === event.callId);
      if (call) {
        call.ok = event.ok;
        call.result = event.result;
        call.latencyMs = event.latencyMs;
      }
      break;
    }
    case 'error':
      outcome.error = { kind: event.kind, message: event.message };
      break;
    case 'done':
      outcome.usage = event.usage;
      outcome.costUsd = event.costUsd;
      outcome.ms = event.ms;
      break;
    default:
      break;
  }
}
