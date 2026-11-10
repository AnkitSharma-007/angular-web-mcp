import type { ActId } from '../app/features/agent-console/demo-prompts';
import type { FakeRequest, FakeScript } from './fake-genai';

export const ACT2_MID_DECEMBER = '2026-12-15';
export const ACT2_BILLING_DATE = '2026-12-01';

export interface ToolOutput {
  name: string;
  ok: boolean;
  value: unknown;
}

interface DealRow {
  id: string;
  account: string;
  probability: number;
}

export function toolOutputs(request: FakeRequest): ToolOutput[] {
  return request.message.flatMap((part) => {
    const response = part.functionResponse;
    if (!response) {
      return [];
    }
    const ok = 'output' in response.response;
    return [
      {
        name: response.name,
        ok,
        value: ok ? response.response['output'] : response.response['error'],
      },
    ];
  });
}

function dealRows(value: unknown): DealRow[] {
  const deals = (value as { deals?: unknown } | null)?.deals;
  return Array.isArray(deals) ? (deals as DealRow[]) : [];
}

function firstOutput(request: FakeRequest): unknown {
  return toolOutputs(request)[0]?.value;
}

export function act1Script(): FakeScript[] {
  return [
    {
      thoughts: ['A broad exposure question: start with the pipeline summary.'],
      functionCalls: [{ name: 'getPipelineSummary' }],
    },
    {
      thoughts: ['Stalled deals are where the pipeline is exposed. List them.'],
      functionCalls: [{ name: 'searchDeals', args: { stalledOnly: true, limit: 5 } }],
    },
    (request) => {
      const stalled = dealRows(firstOutput(request)).map((deal) => deal.account);
      return {
        text: ['The pipeline is exposed on stalled deals: ', stalled.join(', '), '.'],
      };
    },
  ];
}

export function act2Script(): FakeScript[] {
  let dealId = '';
  let clientName = '';
  let contactEmail = '';
  const draft = (startDate: string) => ({
    name: 'draftDealProposal',
    args: {
      dealId,
      clientName,
      contactEmail,
      productTier: 'Enterprise',
      seats: 250,
      termMonths: 24,
      discountPct: 0,
      startDate,
      lineItems: ['Platform license'],
    },
  });
  return [
    { functionCalls: [{ name: 'searchDeals', args: { query: 'Konkan Freight', limit: 1 } }] },
    (request) => {
      dealId = dealRows(firstOutput(request))[0]?.id ?? '';
      return { functionCalls: [{ name: 'getDealDetails', args: { dealId } }] };
    },
    (request) => {
      const details = firstOutput(request) as { account?: string; contactEmail?: string } | null;
      clientName = details?.account ?? '';
      contactEmail = details?.contactEmail ?? '';
      return {
        thoughts: ['A proposal needs the drawer. Open it, then fill the form tool.'],
        functionCalls: [{ name: 'openProposalDrawer', args: { dealId } }],
      };
    },
    () => ({
      thoughts: ['Mid-December: use the 15th.'],
      functionCalls: [draft(ACT2_MID_DECEMBER)],
    }),
    (request) => {
      const [attempt] = toolOutputs(request);
      const billingProblem = !attempt?.ok && String(attempt?.value).includes('startDate');
      return {
        thoughts: ['The start date has to be the 1st of a month. Use the next billing date.'],
        functionCalls: [draft(billingProblem ? ACT2_BILLING_DATE : ACT2_MID_DECEMBER)],
      };
    },
    (request) => ({
      text: toolOutputs(request)[0]?.ok
        ? `Drafted the 24-month Enterprise renewal for ${clientName}, starting ${ACT2_BILLING_DATE}.`
        : 'The proposal could not be saved.',
    }),
  ];
}

export function act3Script(): FakeScript[] {
  return [
    {
      functionCalls: [
        { name: 'searchDeals', args: { query: 'Arcadia Bank', limit: 1 } },
        { name: 'searchDeals', args: { query: 'Monsoon Retail', limit: 1 } },
      ],
    },
    (request) => {
      const [arcadia, monsoon] = toolOutputs(request).map((output) => dealRows(output.value)[0]);
      return {
        functionCalls: [
          {
            name: 'applyBatchDiscount',
            args: {
              dealIds: [arcadia?.id],
              discountPct: 25,
              reason: 'End-of-quarter concession for Arcadia Bank',
            },
          },
          {
            name: 'terminateContract',
            args: { dealId: monsoon?.id, reason: 'Customer is leaving at quarter end' },
          },
        ],
      };
    },
    (request) => {
      const [discount, termination] = toolOutputs(request);
      const rejected = (termination?.value as { status?: string } | null)?.status;
      return {
        text:
          `Arcadia Bank discount: ${(discount?.value as { status?: string } | null)?.status}. ` +
          (rejected === 'rejected_by_human'
            ? 'The Monsoon Retail termination was rejected by a human, so that contract stays active.'
            : 'The Monsoon Retail contract was terminated.'),
      };
    },
  ];
}

export const ACT_SCRIPTS: Readonly<Record<ActId, () => FakeScript[]>> = {
  act1: act1Script,
  act2: act2Script,
  act3: act3Script,
};
