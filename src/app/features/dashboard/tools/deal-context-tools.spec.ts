import { provideExperimentalWebMcpTools } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { SEED_DEALS } from '../../../core/data/seed-deals';
import { isOpen } from '../../../core/models/deal';
import { CLOCK } from '../../../core/util/clock';
import { netValue } from '../../../core/util/money';
import { ToolInputError } from '../../../mcp/tooling/tool-errors';
import { useFakeModelContext } from '../../../../testing/test-providers';
import { DealsStore } from '../data/deals-store';
import { DEAL_CONTEXT_TOOLS, type DealRow } from './deal-context-tools';

interface Summary {
  kpis: unknown;
  byStage: unknown;
  byRegion: unknown;
  topDeals: DealRow[];
  generatedAt: string;
}

interface SearchResult {
  total: number;
  deals: DealRow[];
}

describe('deal context tools', () => {
  const registry = useFakeModelContext();
  let store: InstanceType<typeof DealsStore>;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [
        DealsStore,
        { provide: CLOCK, useValue: () => new Date('2026-11-09T10:00:00.000Z') },
        provideExperimentalWebMcpTools(DEAL_CONTEXT_TOOLS),
      ],
    });
    store = TestBed.inject(DealsStore);
  });

  async function call<T>(name: string, args: Record<string, unknown> = {}): Promise<T> {
    const result = (await registry.current.executeTool(name, args)) as {
      content: { text: string }[];
    };
    return JSON.parse(result.content[0]?.text ?? 'null') as T;
  }

  it('registers three read-only tools with the expected hints', () => {
    const contextNames = DEAL_CONTEXT_TOOLS.map((t) => t.name);
    const tools = registry.current.getTools().filter((t) => contextNames.includes(t.name));
    expect(tools.map((t) => t.name)).toEqual([
      'getDealDetails',
      'getPipelineSummary',
      'searchDeals',
    ]);
    expect(tools.every((t) => t.annotations?.['readOnlyHint'] === true)).toBe(true);
    const untrusted = tools.filter((t) => t.annotations?.['untrustedContentHint'] === true);
    expect(untrusted.map((t) => t.name)).toEqual(['getDealDetails']);
  });

  it('describes each tool with when to use it and strict schemas', () => {
    for (const tool of registry.current.getTools()) {
      expect(tool.description.length).toBeGreaterThan(40);
      expect(tool.inputSchema?.additionalProperties).toBe(false);
    }
  });

  describe('getPipelineSummary', () => {
    it('matches the store computeds', async () => {
      const summary = await call<Summary>('getPipelineSummary');
      expect(summary.kpis).toEqual(store.kpis());
      expect(summary.byStage).toEqual(store.pipelineByStage());
      expect(summary.byRegion).toEqual(store.byRegion());
      expect(summary.generatedAt).toBe('2026-11-09T10:00:00.000Z');
    });

    it('lists the five largest open deals, largest first', async () => {
      const { topDeals } = await call<Summary>('getPipelineSummary');
      expect(topDeals).toHaveLength(5);
      const values = topDeals.map((d) => d.netValue);
      expect(values).toEqual([...values].sort((a, b) => b - a));
      expect(topDeals.every((d) => !d.stage.startsWith('closed'))).toBe(true);
      const expected = SEED_DEALS.filter(isOpen)
        .sort((a, b) => netValue(b) - netValue(a) || a.id.localeCompare(b.id))
        .slice(0, 5)
        .map((d) => d.id);
      expect(topDeals.map((d) => d.id)).toEqual(expected);
    });

    it('reflects mutations', async () => {
      const before = await call<Summary>('getPipelineSummary');
      const top = before.topDeals[0];
      store.applyDiscount([top?.id ?? ''], 50);
      const after = await call<Summary>('getPipelineSummary');
      expect(after.kpis).not.toEqual(before.kpis);
      expect(after.topDeals[0]?.netValue).toBeLessThanOrEqual(top?.netValue ?? 0);
      expect(after.topDeals.every((d) => d.id !== top?.id || d.discountPct === 50)).toBe(true);
    });

    it('rejects unexpected arguments', async () => {
      await expect(call('getPipelineSummary', { verbose: true })).rejects.toBeInstanceOf(
        ToolInputError,
      );
    });
  });

  describe('searchDeals', () => {
    it('returns every deal with a default limit of 25', async () => {
      const { total, deals } = await call<SearchResult>('searchDeals');
      expect(total).toBe(24);
      expect(deals).toHaveLength(24);
    });

    it('combines filters with AND', async () => {
      const { deals } = await call<SearchResult>('searchDeals', {
        regions: ['EMEA'],
        stages: ['negotiation'],
        minProbability: 70,
      });
      expect(deals.map((d) => d.id).sort()).toEqual(['D-1004', 'D-1005']);
    });

    it('applies value, query and stalled filters', async () => {
      const big = await call<SearchResult>('searchDeals', { minValue: 400000 });
      expect(big.deals.every((d) => d.netValue >= 400000)).toBe(true);
      const arcadia = await call<SearchResult>('searchDeals', { query: 'ARCADIA' });
      expect(arcadia.deals.map((d) => d.id)).toEqual(['D-1002']);
      const stalled = await call<SearchResult>('searchDeals', { stalledOnly: true });
      expect(stalled.total).toBe(store.kpis().stalledCount);
      expect(stalled.deals.map((d) => d.id)).toEqual(expect.arrayContaining(['D-1018', 'D-1019']));
    });

    it('caps deals at limit while total stays the full count', async () => {
      const { total, deals } = await call<SearchResult>('searchDeals', { limit: 3 });
      expect(total).toBe(24);
      expect(deals).toHaveLength(3);
    });

    it('returns an empty result without error', async () => {
      expect(await call<SearchResult>('searchDeals', { query: 'no-such-account' })).toEqual({
        total: 0,
        deals: [],
      });
    });

    it('ignores the table view filter', async () => {
      store.setFilter({ regions: ['EMEA'] });
      expect((await call<SearchResult>('searchDeals')).total).toBe(24);
    });

    it('returns compact rows with net value', async () => {
      const { deals } = await call<SearchResult>('searchDeals', { query: 'D-1002' });
      expect(deals[0]).toEqual({
        id: 'D-1002',
        account: 'Arcadia Bank',
        region: 'NA',
        stage: 'negotiation',
        netValue: 420000,
        discountPct: 0,
        probability: expect.any(Number),
        lastActivityDays: expect.any(Number),
      });
    });

    it.each([
      [{ limit: 26 }, 'limit: must be <= 25'],
      [{ limit: 0 }, 'limit: must be >= 1'],
      [{ stages: ['won'] }, 'stages[0]: must be one of'],
      [{ regions: 'EMEA' }, 'regions: expected array'],
      [{ minProbability: 101 }, 'minProbability: must be <= 100'],
      [{ colour: 'red' }, 'colour: is not an allowed property'],
    ])('rejects %j with a helpful path', async (args, message) => {
      await expect(call('searchDeals', args)).rejects.toThrow(message);
    });
  });

  describe('getDealDetails', () => {
    it('returns the full deal', async () => {
      const deal = await call<Record<string, unknown>>('getDealDetails', { dealId: 'D-1001' });
      expect(deal).toEqual(store.entityMap()['D-1001']);
      expect(deal['contactEmail']).toBe('procurement@konkan-freight.example');
    });

    it('explains how to recover from an unknown ID', async () => {
      const error = await call('getDealDetails', { dealId: 'D-9999' }).catch((e: unknown) => e);
      expect(error).toBeInstanceOf(ToolInputError);
      expect((error as Error).message).toContain('Unknown deal D-9999');
      expect((error as Error).message).toContain('searchDeals');
    });

    it.each([
      [{ dealId: 'abc' }, 'dealId: must match'],
      [{ dealId: 'D-12' }, 'dealId: must match'],
      [{}, 'dealId: is required'],
      [{ dealId: 1001 }, 'dealId: expected string'],
    ])('rejects malformed input %j', async (args, message) => {
      await expect(call('getDealDetails', args)).rejects.toThrow(message);
    });
  });
});
