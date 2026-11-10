import {
  calls,
  makeDraft,
  makeOutcome,
  passingOutcome,
  seedDealsView,
  toolCall,
} from '../../../testing/run-outcomes';
import { createSeedDeals } from '../../core/data/seed-deals';
import { findModel } from '../../mcp/agent/gemini/gemini-models';
import {
  ACT_EVALS,
  NON_MUTATING_TOOLS,
  exportEvalJson,
  failedEvalRun,
  findActEval,
  scoreRun,
  summarize,
  toEvalLogRow,
  toEvalRun,
  type EvalRun,
} from './act-evals';

const act1 = findActEval('act1');
const act2 = findActEval('act2');
const act3 = findActEval('act3');
const act4 = findActEval('act4');

const emeaNegotiation = () =>
  createSeedDeals().filter((deal) => deal.region === 'EMEA' && deal.stage === 'negotiation');

const passingAct2 = () => passingOutcome('act2', { prompt: act2.prompts[0] ?? '' });
const passingAct3 = () => passingOutcome('act3');
const passingAct4 = () => passingOutcome('act4');

function evalRun(overrides: Partial<EvalRun> = {}): EvalRun {
  return {
    actId: 'act2',
    index: 0,
    runId: 'run-1',
    prompt: 'p',
    model: 'gemini-3.8-flash',
    passed: true,
    failures: [],
    toolFailures: 0,
    selfCorrected: false,
    toolCalls: 4,
    toolNames: [],
    ms: 1000,
    tokens: 100,
    thinkingTokens: 10,
    costUsd: 0.01,
    ...overrides,
  };
}

describe('act eval definitions', () => {
  it('defines the four acts with the stage prompt first and paraphrases after it', () => {
    expect(ACT_EVALS.map((spec) => spec.id)).toEqual(['act1', 'act2', 'act3', 'act4']);
    for (const spec of ACT_EVALS) {
      expect(spec.prompts.length).toBeGreaterThanOrEqual(3);
      expect(new Set(spec.prompts).size).toBe(spec.prompts.length);
      expect(findModel(spec.model)).toBeDefined();
    }
  });

  it('uses the Sprinter for Act 1 and the Operator for the rest', () => {
    expect(ACT_EVALS.map((spec) => spec.model)).toEqual([
      'gemini-3.5-flash-lite',
      'gemini-3.8-flash',
      'gemini-3.8-flash',
      'gemini-3.8-flash',
    ]);
  });

  it('scripts approve then reject for the governance act only', () => {
    expect(act4.approvals).toEqual(['approve', 'reject']);
    expect(ACT_EVALS.filter((spec) => spec.approvals).map((spec) => spec.id)).toEqual(['act4']);
  });

  it('never lists a required tool as forbidden', () => {
    for (const spec of ACT_EVALS) {
      expect(spec.requiredSequence.filter((name) => spec.forbidden.includes(name))).toEqual([]);
    }
  });

  it('treats view-only tools as non-mutating', () => {
    expect([...NON_MUTATING_TOOLS].sort()).toEqual([
      'getDealDetails',
      'getPipelineSummary',
      'openProposalDrawer',
      'searchDeals',
      'setDealFilter',
    ]);
  });

  it('rejects an unknown act', () => {
    expect(() => findActEval('act9' as never)).toThrow('Unknown act eval');
  });
});

describe('scoreRun', () => {
  describe('required sequence', () => {
    it('passes when the required tools appear in order', () => {
      expect(scoreRun(act2, passingAct2())).toEqual({
        passed: true,
        failures: [],
        selfCorrected: false,
      });
    });

    it('accepts the required tools as a subsequence with read-only calls in between', () => {
      const outcome = passingAct2();
      outcome.toolCalls = calls(
        'getPipelineSummary',
        'setDealFilter',
        'getDealDetails',
        'searchDeals',
        'searchDeals',
        'applyBatchDiscount',
        'updateDealStages',
      );
      expect(scoreRun(act2, outcome).passed).toBe(true);
    });

    describe('steps gated on what the prompt asks for', () => {
      const withoutFilter = ['searchDeals', 'applyBatchDiscount', 'updateDealStages'] as const;

      it('requires setDealFilter for the stage prompt and for the Filter paraphrase', () => {
        for (const prompt of act2.prompts.slice(0, 2)) {
          const outcome = passingAct2();
          outcome.prompt = prompt;
          outcome.toolCalls = calls(...withoutFilter);
          expect(scoreRun(act2, outcome).failures.join('\n')).toContain('Missing setDealFilter');
        }
      });

      it('does not demand setDealFilter when the prompt never asks to show or filter', () => {
        const prompt = act2.prompts[2] ?? '';
        expect(prompt).not.toMatch(/\b(show|filter)\b/i);
        const outcome = passingAct2();
        outcome.prompt = prompt;
        outcome.toolCalls = calls(...withoutFilter);
        expect(scoreRun(act2, outcome).passed).toBe(true);
      });

      it('still requires the mutations and the business state for that prompt', () => {
        const outcome = passingAct2();
        outcome.prompt = act2.prompts[2] ?? '';
        outcome.toolCalls = calls('searchDeals', 'applyBatchDiscount');
        expect(scoreRun(act2, outcome).failures[0]).toMatch(/^Missing updateDealStages/);
        expect(scoreRun(act2, outcome).failures[0]).toContain(
          'searchDeals → applyBatchDiscount → updateDealStages',
        );

        const wrongState = passingAct2();
        wrongState.prompt = act2.prompts[2] ?? '';
        wrongState.toolCalls = calls(...withoutFilter);
        wrongState.deals = seedDealsView();
        expect(scoreRun(act2, wrongState).failures.join('\n')).toContain('State check');
      });
    });

    it('fails when the order is wrong', () => {
      const outcome = passingAct2();
      outcome.toolCalls = calls(
        'setDealFilter',
        'searchDeals',
        'updateDealStages',
        'applyBatchDiscount',
      );
      const score = scoreRun(act2, outcome);
      expect(score.passed).toBe(false);
      expect(score.failures).toContain(
        'Missing updateDealStages in the order setDealFilter → searchDeals → applyBatchDiscount → updateDealStages',
      );
    });

    it('fails when a mutation never happened', () => {
      const outcome = passingAct2();
      outcome.toolCalls = calls('setDealFilter', 'searchDeals', 'applyBatchDiscount');
      expect(scoreRun(act2, outcome).failures[0]).toMatch(/^Missing updateDealStages/);
    });

    it('does not count one call twice for two required slots', () => {
      const outcome = passingAct4();
      outcome.toolCalls = calls('applyBatchDiscount');
      expect(scoreRun(act4, outcome).failures.join('\n')).toContain('Missing terminateContract');
    });
  });

  describe('extra and forbidden calls', () => {
    it('tolerates read-only extras', () => {
      const outcome = passingAct2();
      outcome.toolCalls = [...outcome.toolCalls, toolCall('getPipelineSummary')];
      expect(scoreRun(act2, outcome).passed).toBe(true);
    });

    it('does not tolerate any extra call under "none"', () => {
      const strict = { ...act2, allowedExtras: 'none' as const };
      const outcome = passingAct2();
      outcome.toolCalls = [...outcome.toolCalls, toolCall('getPipelineSummary')];
      expect(scoreRun(strict, outcome).failures).toEqual(['Unexpected call: getPipelineSummary']);
    });

    it('accepts exactly the required calls under "none"', () => {
      const strict = { ...act2, allowedExtras: 'none' as const };
      expect(scoreRun(strict, passingAct2()).passed).toBe(true);
    });

    it('fails an unexpected mutation that is not forbidden by name', () => {
      const lenient = { ...act3, forbidden: [] };
      const outcome = passingAct3();
      outcome.toolCalls = [...outcome.toolCalls, toolCall('terminateContract')];
      expect(scoreRun(lenient, outcome).failures).toEqual([
        'Unexpected mutation: terminateContract',
      ]);
    });

    it('fails a forbidden call once, however often it was made', () => {
      const outcome = passingAct2();
      outcome.toolCalls = [
        ...outcome.toolCalls,
        toolCall('terminateContract'),
        toolCall('terminateContract'),
      ];
      expect(scoreRun(act2, outcome).failures).toEqual(['Forbidden call: terminateContract']);
    });
  });

  describe('errors and rejection handling', () => {
    it('fails a run that ended with an error, however good the state is', () => {
      const outcome = passingAct2();
      outcome.error = { kind: 'max-steps', message: 'Stopped after 8 steps' };
      expect(scoreRun(act2, outcome).failures).toEqual([
        'Run error (max-steps): Stopped after 8 steps',
      ]);
    });

    it('fails a stopped run', () => {
      const outcome = passingAct2();
      outcome.stopped = true;
      expect(scoreRun(act2, outcome).failures).toEqual(['Run was stopped']);
    });

    it('fails a retry of a tool after a human rejected it', () => {
      const outcome = passingAct4();
      outcome.toolCalls = [...outcome.toolCalls, toolCall('terminateContract')];
      expect(scoreRun(act4, outcome).failures).toEqual([
        'Retried terminateContract after it was rejected',
      ]);
    });

    it('does not mistake the rejected call itself for a retry', () => {
      expect(scoreRun(act4, passingAct4()).passed).toBe(true);
    });

    it('allows more calls to a tool that was approved', () => {
      const outcome = passingAct4();
      outcome.toolCalls = [...outcome.toolCalls, toolCall('applyBatchDiscount')];
      expect(scoreRun(act4, outcome).passed).toBe(true);
    });
  });

  describe('state assertions', () => {
    it('Act 1 fails when data changed', () => {
      const outcome = makeOutcome({
        toolCalls: calls('getPipelineSummary'),
        deals: seedDealsView((deals) => {
          const first = deals[0];
          if (first) {
            first.discountPct = 30;
          }
        }),
      });
      expect(scoreRun(act1, outcome).failures).toEqual([
        'State check: Act 1 must not change data, but D-1001 changed',
      ]);
    });

    it('Act 1 fails when the history grew', () => {
      const outcome = makeOutcome({
        toolCalls: calls('getPipelineSummary'),
        deals: { ...seedDealsView(), historyCount: 1 },
      });
      expect(scoreRun(act1, outcome).failures[0]).toContain('history changed');
    });

    it('Act 1 passes on untouched data', () => {
      expect(scoreRun(act1, makeOutcome({ toolCalls: calls('getPipelineSummary') })).passed).toBe(
        true,
      );
    });

    it('Act 2 fails with the message when a deal got the wrong discount', () => {
      const outcome = passingAct2();
      const target = emeaNegotiation()[0];
      const deal = outcome.deals.deals.find((candidate) => candidate.id === target?.id);
      if (deal) {
        deal.discountPct = 15;
      }
      expect(scoreRun(act2, outcome).failures).toEqual([
        `State check: ${target?.id} (${target?.account}) has 15% discount, expected 10%`,
      ]);
    });

    it('Act 2 fails when a high-probability deal was not closed', () => {
      const outcome = passingAct2();
      const high = emeaNegotiation().find((deal) => deal.probability > 70);
      const deal = outcome.deals.deals.find((candidate) => candidate.id === high?.id);
      if (deal) {
        deal.stage = 'negotiation';
      }
      expect(scoreRun(act2, outcome).failures[0]).toContain('is negotiation, expected closed-won');
    });

    it('Act 2 fails when a low-probability deal was closed', () => {
      const outcome = passingAct2();
      const low = emeaNegotiation().find((deal) => deal.probability <= 70);
      const deal = outcome.deals.deals.find((candidate) => candidate.id === low?.id);
      if (deal) {
        deal.stage = 'closed-won';
      }
      expect(scoreRun(act2, outcome).failures[0]).toContain('is closed-won, expected negotiation');
    });

    it('Act 2 fails when a deal out of scope was touched', () => {
      const outcome = passingAct2();
      const other = outcome.deals.deals.find((deal) => deal.region !== 'EMEA');
      if (other) {
        other.discountPct = 10;
      }
      expect(scoreRun(act2, outcome).failures[0]).toContain('changed but was out of scope');
    });

    it('Act 2 fails when a target deal is missing', () => {
      const outcome = passingAct2();
      const target = emeaNegotiation()[0];
      outcome.deals = {
        ...outcome.deals,
        deals: outcome.deals.deals.filter((deal) => deal.id !== target?.id),
      };
      expect(scoreRun(act2, outcome).failures).toEqual([`State check: ${target?.id} is missing`]);
    });

    it('Act 3 passes with a correct draft starting on a billing date in December', () => {
      expect(scoreRun(act3, passingAct3())).toMatchObject({ passed: true, failures: [] });
    });

    it('Act 3 accepts January 1st as the billing start', () => {
      const outcome = passingAct3();
      outcome.proposals = { drafts: [makeDraft({ startDate: '2027-01-01' })] };
      expect(scoreRun(act3, outcome).passed).toBe(true);
    });

    it('Act 3 fails without a saved draft', () => {
      const outcome = passingAct3();
      outcome.proposals = { drafts: [] };
      expect(scoreRun(act3, outcome).failures).toEqual([
        'State check: No proposal draft was saved',
      ]);
    });

    it('Act 3 fails with more than one draft', () => {
      const outcome = passingAct3();
      outcome.proposals = { drafts: [makeDraft(), makeDraft({ id: 'P-0002' })] };
      expect(scoreRun(act3, outcome).failures).toEqual([
        'State check: 2 drafts were saved, expected 1',
      ]);
    });

    it.each([
      [{ dealId: 'D-1002' }, 'deal is D-1002, expected D-1001'],
      [{ productTier: 'Growth' as const }, 'tier is Growth, expected Enterprise'],
      [{ seats: 25 }, 'seats is 25, expected 250'],
      [{ termMonths: 12 }, 'term is 12, expected 24'],
      [
        { startDate: '2026-12-15' },
        'start date is 2026-12-15, expected the 1st of December or January',
      ],
      [
        { startDate: '2026-11-01' },
        'start date is 2026-11-01, expected the 1st of December or January',
      ],
    ])('Act 3 fails on a wrong field %j', (change, message) => {
      const outcome = passingAct3();
      outcome.proposals = { drafts: [makeDraft(change)] };
      expect(scoreRun(act3, outcome).failures).toEqual([`State check: ${message}`]);
    });

    it('Act 3 fails when the run also changed deal data', () => {
      const outcome = passingAct3();
      outcome.deals = seedDealsView((deals) => {
        const first = deals[1];
        if (first) {
          first.discountPct = 3;
        }
      });
      expect(scoreRun(act3, outcome).failures).toEqual(['State check: deal data changed']);
    });

    it('Act 4 fails when the approved discount was not applied', () => {
      const outcome = passingAct4();
      outcome.deals = seedDealsView();
      expect(scoreRun(act4, outcome).failures).toEqual([
        'State check: Arcadia Bank has 0% discount, expected the approved 25%',
      ]);
    });

    it('Act 4 fails when the rejected termination happened anyway', () => {
      const outcome = passingAct4();
      const monsoon = outcome.deals.deals.find((deal) => deal.account === 'Monsoon Retail');
      if (monsoon) {
        monsoon.contractStatus = 'terminated';
      }
      expect(scoreRun(act4, outcome).failures).toEqual([
        'State check: Monsoon Retail contract is terminated, but the termination was rejected',
      ]);
    });

    it('reports a crashing check as a failure instead of throwing', () => {
      const broken = {
        ...act1,
        assertState: () => {
          throw new Error('boom');
        },
      };
      expect(
        scoreRun(broken, makeOutcome({ toolCalls: calls('getPipelineSummary') })).failures,
      ).toEqual(['State check: the check crashed: boom']);
    });

    it('reports a check that throws a non-Error value', () => {
      const broken = {
        ...act1,
        assertState: () => {
          throw 'nope';
        },
      };
      expect(
        scoreRun(broken, makeOutcome({ toolCalls: calls('getPipelineSummary') })).failures,
      ).toEqual(['State check: the check crashed: nope']);
    });
  });

  describe('self-correction', () => {
    it('flags a passing run that recovered from a failed tool call', () => {
      const outcome = passingAct3();
      outcome.toolCalls = [
        toolCall('openProposalDrawer'),
        toolCall('draftDealProposal', false),
        toolCall('draftDealProposal', true),
      ];
      expect(scoreRun(act3, outcome)).toMatchObject({ passed: true, selfCorrected: true });
    });

    it('does not flag a run without failed calls or one that did not pass', () => {
      expect(scoreRun(act3, passingAct3()).selfCorrected).toBe(false);
      const failed = passingAct3();
      failed.toolCalls = [toolCall('draftDealProposal', false)];
      expect(scoreRun(act3, failed)).toMatchObject({ passed: false, selfCorrected: false });
    });
  });
});

describe('toEvalRun', () => {
  it('flattens an outcome into a serializable row', () => {
    const outcome = passingAct3();
    outcome.toolCalls = [
      toolCall('openProposalDrawer'),
      toolCall('draftDealProposal', false),
      toolCall('draftDealProposal'),
    ];
    expect(toEvalRun(act3, outcome, 2)).toEqual({
      actId: 'act3',
      index: 2,
      runId: 'run-1',
      prompt: 'prompt',
      model: 'gemini-3.8-flash',
      passed: true,
      failures: [],
      toolFailures: 1,
      selfCorrected: true,
      toolCalls: 3,
      toolNames: ['openProposalDrawer', 'draftDealProposal', 'draftDealProposal'],
      ms: 1500,
      tokens: 130,
      thinkingTokens: 10,
      costUsd: 0.002,
    });
  });

  it('builds a failed row for a run that never produced an outcome', () => {
    expect(failedEvalRun(act2, 3, 'the prompt', 'act2-4', 'network down')).toMatchObject({
      actId: 'act2',
      index: 3,
      runId: 'act2-4',
      prompt: 'the prompt',
      model: 'gemini-3.8-flash',
      passed: false,
      failures: ['Run error (unknown): network down'],
      toolCalls: 0,
    });
  });
});

describe('summarize', () => {
  it('computes the pass rate and the time percentiles', () => {
    const runs = [
      evalRun({ ms: 1000 }),
      evalRun({ ms: 2000 }),
      evalRun({ ms: 3000 }),
      evalRun({ ms: 4000, passed: false }),
      evalRun({ ms: 10_000 }),
    ];
    expect(summarize('act2', runs)).toMatchObject({
      actId: 'act2',
      runs: 5,
      passes: 4,
      passRate: 0.8,
      p50Ms: 3000,
      p90Ms: 10_000,
    });
  });

  it('takes the median of tool calls, tokens and cost', () => {
    const runs = [
      evalRun({ toolCalls: 2, tokens: 300, costUsd: 0.03 }),
      evalRun({ toolCalls: 9, tokens: 100, costUsd: 0.01 }),
      evalRun({ toolCalls: 4, tokens: 200, costUsd: 0.02 }),
    ];
    expect(summarize('act2', runs)).toMatchObject({
      medianToolCalls: 4,
      medianTokens: 200,
      medianCostUsd: 0.02,
    });
  });

  it('reports the self-correction rate among the runs that hit a tool failure', () => {
    const runs = [
      evalRun({ toolFailures: 1, passed: true, selfCorrected: true }),
      evalRun({ toolFailures: 2, passed: false }),
      evalRun({ toolFailures: 1, passed: true, selfCorrected: true }),
      evalRun({ toolFailures: 0 }),
    ];
    expect(summarize('act3', runs).selfCorrectionRate).toBeCloseTo(2 / 3);
  });

  it('has no self-correction rate when nothing failed', () => {
    expect(summarize('act3', [evalRun(), evalRun()]).selfCorrectionRate).toBeNull();
  });

  it('copes with no runs at all', () => {
    expect(summarize('act1', [])).toEqual({
      actId: 'act1',
      runs: 0,
      passes: 0,
      passRate: 0,
      p50Ms: 0,
      p90Ms: 0,
      medianToolCalls: 0,
      medianTokens: 0,
      medianCostUsd: 0,
      selfCorrectionRate: null,
    });
  });
});

describe('eval log export', () => {
  const summary = summarize('act2', [
    evalRun({ ms: 6000 }),
    evalRun({ ms: 8200 }),
    evalRun({ ms: 7000, passed: false }),
  ]);

  it('formats a row as date | act | change | pass before → after | p90', () => {
    expect(
      toEvalLogRow(summary, {
        date: '2026-11-09',
        change: 'Reworded setDealFilter',
        before: '3/5',
      }),
    ).toBe('| 2026-11-09 | act2 | Reworded setDealFilter | 3/5 → 2/3 | 8.2 s |');
  });

  it('labels a first run as baseline with no previous result', () => {
    expect(toEvalLogRow(summary, { date: '2026-11-09', change: '  ' })).toBe(
      '| 2026-11-09 | act2 | baseline | – → 2/3 | 8.2 s |',
    );
  });

  it('escapes pipes in the change text so the table stays intact', () => {
    expect(toEvalLogRow(summary, { date: '2026-11-09', change: 'a | b' })).toContain('| a \\| b |');
  });

  it('exports summaries and runs as JSON with the export time', () => {
    const runs = [evalRun()];
    const json = JSON.parse(exportEvalJson([summary], runs, new Date('2026-11-09T10:00:00Z')));
    expect(json.exportedAt).toBe('2026-11-09T10:00:00.000Z');
    expect(json.summaries).toEqual([summary]);
    expect(json.runs).toEqual(runs);
  });
});
