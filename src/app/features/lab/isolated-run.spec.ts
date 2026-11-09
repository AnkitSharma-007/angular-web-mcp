import { TestBed } from '@angular/core/testing';
import { CLOCK } from '../../core/util/clock';
import { createProposalModel } from '../../core/models/proposal';
import type { AgentEvent } from '../../mcp/agent/agent-events';
import { GeminiAgent, type AgentRunOptions } from '../../mcp/agent/gemini/gemini-agent';
import { WireTelemetryStore } from '../../mcp/telemetry/wire-telemetry-store';
import type { ApprovalDecision, ApprovalRequest } from '../../mcp/tooling/approval-gate';
import { ApprovalService } from '../approvals/approval-service';
import { DashboardUiStore } from '../dashboard/data/dashboard-ui-store';
import { DealsStore } from '../dashboard/data/deals-store';
import { ProposalsStore } from '../proposal/proposals-store';
import { IsolatedRunner } from './isolated-run';

type Behaviour = (prompt: string, options: AgentRunOptions) => AsyncGenerator<AgentEvent>;

const DONE: AgentEvent = {
  type: 'done',
  usage: { input: 100, output: 20, thinking: 10 },
  costUsd: 0.004,
  model: 'gemini-3.8-flash',
  ms: 900,
};

const request = (toolName: string): ApprovalRequest => ({
  toolName,
  risk: 'high',
  summary: `Approve ${toolName}`,
});

let behaviour: Behaviour;
let seen: { prompt: string; options: AgentRunOptions }[];
let now: number;

function setup() {
  seen = [];
  now = 1_000;
  behaviour = async function* () {
    yield DONE;
  };
  TestBed.configureTestingModule({
    providers: [
      DealsStore,
      ProposalsStore,
      DashboardUiStore,
      IsolatedRunner,
      { provide: CLOCK, useValue: () => new Date(now) },
      {
        provide: GeminiAgent,
        useValue: {
          run: (prompt: string, options: AgentRunOptions) => {
            seen.push({ prompt, options });
            return behaviour(prompt, options);
          },
        },
      },
    ],
  });
  return {
    runner: TestBed.inject(IsolatedRunner),
    deals: TestBed.inject(DealsStore),
    proposals: TestBed.inject(ProposalsStore),
    ui: TestBed.inject(DashboardUiStore),
    approvals: TestBed.inject(ApprovalService),
    telemetry: TestBed.inject(WireTelemetryStore),
  };
}

const RUN = { prompt: 'Do the thing', model: 'gemini-3.8-flash' };

describe('IsolatedRunner', () => {
  beforeAll(() => import('../../mcp/agent/gemini/gemini-agent'));

  describe('isolation', () => {
    it('leaves every store exactly as it found it', async () => {
      const { runner, deals, proposals, ui } = setup();
      const before = {
        deals: deals.snapshotState(),
        proposals: proposals.snapshotState(),
        ui: ui.snapshotState(),
      };
      behaviour = async function* () {
        deals.recordSnapshot('10% off');
        deals.applyDiscount(['D-1002', 'D-1003'], 10);
        deals.moveStages([{ dealId: 'D-1002', stage: 'closed-won' }]);
        deals.terminateContract('D-1001');
        deals.setFilter({ regions: ['EMEA'] });
        proposals.saveDraft(createProposalModel({ dealId: 'D-1001' }));
        ui.openProposal('D-1001');
        yield DONE;
      };

      await runner.run(RUN);

      expect(deals.snapshotState()).toEqual(before.deals);
      expect(proposals.snapshotState()).toEqual(before.proposals);
      expect(ui.snapshotState()).toEqual(before.ui);
    });

    it('keeps the history clean', async () => {
      const { runner, deals } = setup();
      deals.recordSnapshot('earlier change');
      const earlier = deals.history();
      behaviour = async function* () {
        deals.recordSnapshot('agent change');
        deals.applyDiscount(['D-1002'], 12);
        yield DONE;
      };

      await runner.run(RUN);

      expect(deals.history()).toEqual(earlier);
      expect(deals.canUndo()).toBe(true);
    });

    it('restores a state that was already changed before the run', async () => {
      const { runner, deals } = setup();
      deals.applyDiscount(['D-1002'], 7);
      behaviour = async function* () {
        deals.applyDiscount(['D-1002'], 30);
        yield DONE;
      };

      await runner.run(RUN);

      expect(deals.entityMap()['D-1002']?.discountPct).toBe(7);
    });

    it('reports what the run changed, captured before the restore', async () => {
      const { runner, deals, proposals } = setup();
      behaviour = async function* () {
        deals.applyDiscount(['D-1002'], 12);
        deals.setFilter({ regions: ['EMEA'] });
        deals.recordSnapshot('agent change');
        proposals.saveDraft(createProposalModel({ dealId: 'D-1001' }));
        yield DONE;
      };

      const outcome = await runner.run(RUN);

      expect(outcome.deals.deals.find((deal) => deal.id === 'D-1002')?.discountPct).toBe(12);
      expect(outcome.deals.filter.regions).toEqual(['EMEA']);
      expect(outcome.deals.historyCount).toBe(1);
      expect(outcome.proposals.drafts.map((draft) => draft.dealId)).toEqual(['D-1001']);
      expect(deals.entityMap()['D-1002']?.discountPct).toBe(0);
    });

    it('restores the stores even when the run is stopped half-way', async () => {
      const { runner, deals } = setup();
      const controller = new AbortController();
      behaviour = async function* () {
        deals.applyDiscount(['D-1002'], 12);
        controller.abort();
      };

      const outcome = await runner.run({ ...RUN, signal: controller.signal });

      expect(outcome.stopped).toBe(true);
      expect(deals.entityMap()['D-1002']?.discountPct).toBe(0);
    });
  });

  describe('scripted approvals', () => {
    it('applies the script in order and rejects anything unscripted', async () => {
      const { runner, approvals } = setup();
      const answers: ApprovalDecision[] = [];
      behaviour = async function* (_, { signal }) {
        answers.push(await approvals.request(request('applyBatchDiscount'), signal));
        answers.push(await approvals.request(request('terminateContract'), signal));
        answers.push(await approvals.request(request('terminateContract'), signal));
        yield DONE;
      };

      const outcome = await runner.run({ ...RUN, approvals: ['approve', 'reject'] });

      expect(answers.map((answer) => answer.approved)).toEqual([true, false, false]);
      expect(outcome.decisions).toEqual([
        { toolName: 'applyBatchDiscount', approved: true, scripted: true, callsBefore: 0 },
        { toolName: 'terminateContract', approved: false, scripted: true, callsBefore: 0 },
        { toolName: 'terminateContract', approved: false, scripted: false, callsBefore: 0 },
      ]);
      expect(answers[2]?.note).toBe('no scripted decision');
    });

    it('rejects every approval when no script is given', async () => {
      const { runner, approvals } = setup();
      let answer: ApprovalDecision | undefined;
      behaviour = async function* (_, { signal }) {
        answer = await approvals.request(request('terminateContract'), signal);
        yield DONE;
      };

      await runner.run(RUN);

      expect(answer?.approved).toBe(false);
    });

    it('counts the tool calls made before each decision', async () => {
      const { runner, approvals } = setup();
      behaviour = async function* (_, { signal }) {
        yield { type: 'tool-call', callId: 'a', name: 'searchDeals', args: {} };
        yield { type: 'tool-call', callId: 'b', name: 'terminateContract', args: {} };
        await approvals.request(request('terminateContract'), signal);
        yield DONE;
      };

      const outcome = await runner.run({ ...RUN, approvals: ['reject'] });

      expect(outcome.decisions[0]?.callsBefore).toBe(2);
    });

    it('clears the decider after a normal run', async () => {
      const { runner, approvals } = setup();
      const setAutoDecider = vi.spyOn(approvals, 'setAutoDecider');

      await runner.run(RUN);

      expect(setAutoDecider).toHaveBeenCalledTimes(2);
      expect(setAutoDecider).toHaveBeenLastCalledWith(null);
    });

    it('clears the decider and restores the stores even when the agent throws', async () => {
      const { runner, approvals, deals } = setup();
      const setAutoDecider = vi.spyOn(approvals, 'setAutoDecider');
      behaviour = async function* () {
        deals.applyDiscount(['D-1002'], 12);
        yield* [] as AgentEvent[];
        throw new Error('stream exploded');
      };

      const outcome = await runner.run(RUN);

      expect(outcome.error).toEqual({ kind: 'unknown', message: 'stream exploded' });
      expect(setAutoDecider).toHaveBeenLastCalledWith(null);
      expect(deals.entityMap()['D-1002']?.discountPct).toBe(0);
    });

    it('handles a thrown value that is not an Error', async () => {
      const { runner } = setup();
      behaviour = async function* () {
        yield* [] as AgentEvent[];
        throw 'plain string';
      };

      const outcome = await runner.run(RUN);

      expect(outcome.error?.message).toBe('plain string');
    });
  });

  describe('run ids and telemetry', () => {
    it('tags every packet of the run, including approvals and tool calls', async () => {
      const { runner, approvals, telemetry } = setup();
      behaviour = async function* (_, { signal }) {
        telemetry.record({ channel: 'mcp', method: 'tools/list' }, { status: 'ok' });
        await approvals.request(request('terminateContract'), signal);
        telemetry.record(
          { channel: 'mcp', method: 'tools/call', params: { name: 'x' } },
          { status: 'ok' },
        );
        yield DONE;
      };

      const outcome = await runner.run({ ...RUN, runId: 'eval-act4-1' });

      const packets = telemetry.entities();
      expect(outcome.runId).toBe('eval-act4-1');
      expect(packets.length).toBeGreaterThanOrEqual(4);
      expect(packets.every((packet) => packet.runId === 'eval-act4-1')).toBe(true);
    });

    it('stops tagging when the run is over', async () => {
      const { runner, telemetry } = setup();

      await runner.run(RUN);
      const id = telemetry.record({ channel: 'mcp', method: 'tools/list' }, { status: 'ok' });

      expect(telemetry.entityMap()[id]?.runId).toBeUndefined();
    });

    it('gives each run its own id and passes it to the agent with the model', async () => {
      const { runner } = setup();

      const first = await runner.run(RUN);
      const second = await runner.run({ ...RUN, model: 'gemini-3.5-flash-lite', maxSteps: 3 });

      expect(first.runId).not.toBe(second.runId);
      expect(seen[0]?.options).toMatchObject({ model: 'gemini-3.8-flash', runId: first.runId });
      expect(seen[0]?.options.maxSteps).toBeUndefined();
      expect(seen[1]?.options).toMatchObject({
        model: 'gemini-3.5-flash-lite',
        maxSteps: 3,
        runId: second.runId,
      });
      expect(seen[0]?.prompt).toBe('Do the thing');
    });
  });

  describe('outcome', () => {
    it('folds events into text, tool calls, usage, cost and time', async () => {
      const { runner } = setup();
      behaviour = async function* () {
        yield { type: 'thought', text: 'hmm' };
        yield { type: 'tool-call', callId: 'c1', name: 'searchDeals', args: { limit: 3 } };
        yield {
          type: 'tool-result',
          callId: 'c1',
          name: 'searchDeals',
          result: { total: 3 },
          ok: true,
          latencyMs: 8,
        };
        yield { type: 'tool-call', callId: 'c2', name: 'draftDealProposal', args: {} };
        yield {
          type: 'tool-result',
          callId: 'c2',
          name: 'draftDealProposal',
          result: 'Form submission failed',
          ok: false,
          latencyMs: 4,
        };
        yield {
          type: 'tool-result',
          callId: 'unknown',
          name: 'ghost',
          result: 1,
          ok: true,
          latencyMs: 1,
        };
        yield { type: 'tools-changed', added: ['draftDealProposal'], removed: [] };
        yield { type: 'text-delta', text: 'Top ' };
        yield { type: 'text-delta', text: 'three.' };
        yield DONE;
      };

      const outcome = await runner.run(RUN);

      expect(outcome.text).toBe('Top three.');
      expect(outcome.toolCalls).toEqual([
        {
          callId: 'c1',
          name: 'searchDeals',
          args: { limit: 3 },
          ok: true,
          result: { total: 3 },
          latencyMs: 8,
        },
        {
          callId: 'c2',
          name: 'draftDealProposal',
          args: {},
          ok: false,
          result: 'Form submission failed',
          latencyMs: 4,
        },
      ]);
      expect(outcome.usage).toEqual(DONE.type === 'done' ? DONE.usage : null);
      expect(outcome.costUsd).toBe(0.004);
      expect(outcome.ms).toBe(900);
      expect(outcome.events).toHaveLength(10);
      expect(outcome.error).toBeNull();
      expect(outcome.stopped).toBe(false);
    });

    it('records an agent error event', async () => {
      const { runner } = setup();
      behaviour = async function* () {
        yield { type: 'error', kind: 'quota', message: 'slow down' };
        yield DONE;
      };

      const outcome = await runner.run(RUN);

      expect(outcome.error).toEqual({ kind: 'quota', message: 'slow down' });
    });

    it('measures the time itself when the agent never finishes', async () => {
      const { runner } = setup();
      behaviour = async function* () {
        now += 2_500;
        yield* [] as AgentEvent[];
      };

      const outcome = await runner.run(RUN);

      expect(outcome.ms).toBe(2_500);
      expect(outcome.usage).toEqual({ input: 0, output: 0, thinking: 0 });
      expect(outcome.costUsd).toBe(0);
    });
  });

  describe('eval mode and ordering', () => {
    it('is on while a run is active and off afterwards', async () => {
      const { runner } = setup();
      const during: boolean[] = [];
      const ids: (string | null)[] = [];
      behaviour = async function* () {
        during.push(runner.evalMode());
        ids.push(runner.activeRunId());
        yield DONE;
      };

      expect(runner.evalMode()).toBe(false);
      const outcome = await runner.run(RUN);

      expect(during).toEqual([true]);
      expect(ids).toEqual([outcome.runId]);
      expect(runner.evalMode()).toBe(false);
      expect(runner.activeRunId()).toBeNull();
    });

    it('stays on for a whole batch and releases only once', () => {
      const { runner } = setup();
      const release = runner.beginBatch();
      expect(runner.evalMode()).toBe(true);
      release();
      release();
      expect(runner.evalMode()).toBe(false);
    });

    it('runs queued prompts one at a time, in order', async () => {
      const { runner } = setup();
      const log: string[] = [];
      let open!: () => void;
      const gate = new Promise<void>((resolve) => (open = resolve));
      behaviour = async function* (prompt) {
        log.push(`start ${prompt}`);
        if (prompt === 'first') {
          await gate;
        }
        log.push(`end ${prompt}`);
        yield DONE;
      };

      const first = runner.run({ ...RUN, prompt: 'first' });
      const second = runner.run({ ...RUN, prompt: 'second' });
      await vi.waitFor(() => expect(log).toEqual(['start first']));
      open();
      await Promise.all([first, second]);

      expect(log).toEqual(['start first', 'end first', 'start second', 'end second']);
    });

    it('still runs the next prompt after one failed to start', async () => {
      const { runner } = setup();
      let attempt = 0;
      behaviour = (prompt) => {
        if (++attempt === 1) {
          throw new Error('cannot start');
        }
        return (async function* () {
          yield { type: 'text-delta', text: prompt } as AgentEvent;
          yield DONE;
        })();
      };

      const first = await runner.run(RUN);
      const second = await runner.run({ ...RUN, prompt: 'again' });

      expect(first.error?.message).toBe('cannot start');
      expect(second.text).toBe('again');
    });
  });
});
