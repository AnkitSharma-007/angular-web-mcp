import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { Subject } from 'rxjs';
import { MatSnackBar } from '@angular/material/snack-bar';
import { SEED_DEALS } from '../../../core/data/seed-deals';
import { EMPTY_FILTER, isOpen } from '../../../core/models/deal';
import { CLOCK } from '../../../core/util/clock';
import { netValue } from '../../../core/util/money';
import {
  HUMAN_APPROVAL_GATE,
  type ApprovalDecision,
  type ApprovalRequest,
} from '../../../mcp/tooling/approval-gate';
import { useFakeModelContext } from '../../../../testing/test-providers';
import { WireTelemetryStore } from '../../../mcp/telemetry/wire-telemetry-store';
import { DealsStore } from '../data/deals-store';

const EMEA_NEGOTIATION = ['D-1004', 'D-1005', 'D-1006', 'D-1007'];
const REASON = 'Quarter-end push';

interface MutationOutput {
  status: string;
  changed?: { id: string; before: unknown; after: unknown }[];
  moved?: { id: string; before: unknown; after: unknown }[];
  skipped: { id: string; why: string }[];
  revenueImpact?: number;
}

describe('deal mutation tools', () => {
  const registry = useFakeModelContext();
  let actions: Subject<void>[] = [];
  const open = vi.fn<(message: string, action?: string, config?: unknown) => unknown>(() => {
    const action = new Subject<void>();
    actions.push(action);
    return { onAction: () => action };
  });
  const request =
    vi.fn<(request: ApprovalRequest, signal: AbortSignal) => Promise<ApprovalDecision>>();
  let store: InstanceType<typeof DealsStore>;

  function setup(withGate: boolean) {
    open.mockClear();
    actions = [];
    request.mockReset();
    TestBed.configureTestingModule({
      providers: [
        DealsStore,
        { provide: CLOCK, useValue: () => new Date('2026-11-09T10:00:00.000Z') },
        { provide: MatSnackBar, useValue: { open } },
        ...(withGate
          ? [{ provide: HUMAN_APPROVAL_GATE, useValue: { pending: signal(null), request } }]
          : []),
      ],
    });
    store = TestBed.inject(DealsStore);
  }

  async function call<T = MutationOutput>(name: string, args: Record<string, unknown>) {
    const result = (await registry.current.callOrThrow(name, args)) as {
      content: { text: string }[];
    };
    return JSON.parse(result.content[0]?.text ?? 'null') as T;
  }

  const discounts = () => store.entities().map((deal) => deal.discountPct);

  describe('registration', () => {
    beforeEach(() => setup(false));

    it('registers four tools with strict schemas and the right hints', () => {
      const tools = registry.current.toolInfos();
      expect(tools.map((tool) => tool.name)).toEqual([
        'applyBatchDiscount',
        'setDealFilter',
        'terminateContract',
        'updateDealStages',
      ]);
      for (const tool of tools) {
        expect(tool.inputSchema?.additionalProperties).toBe(false);
        expect(tool.description.length).toBeGreaterThan(80);
      }
      const hinted = tools.filter((tool) => tool.annotations?.['consequentialHint'] === true);
      expect(hinted.map((tool) => tool.name)).toEqual([
        'applyBatchDiscount',
        'terminateContract',
        'updateDealStages',
      ]);
    });

    it('requires a reason of 3-200 characters on every mutation', async () => {
      const args = { dealIds: ['D-1004'], discountPct: 5 };
      await expect(call('applyBatchDiscount', args)).rejects.toThrow('reason');
      await expect(call('applyBatchDiscount', { ...args, reason: 'ab' })).rejects.toThrow('reason');
      await expect(
        call('applyBatchDiscount', { ...args, reason: 'x'.repeat(201) }),
      ).rejects.toThrow('reason');
      await expect(
        call('updateDealStages', { updates: [{ dealId: 'D-1004', stage: 'proposal' }] }),
      ).rejects.toThrow('reason');
      expect(store.canUndo()).toBe(false);
    });
  });

  describe('applyBatchDiscount', () => {
    it('returns before/after per deal and the revenue impact, and snapshots once', async () => {
      setup(false);
      const output = await call('applyBatchDiscount', {
        dealIds: EMEA_NEGOTIATION,
        discountPct: 10,
        reason: REASON,
      });

      expect(output.status).toBe('partial');
      expect(output.changed).toEqual([
        { id: 'D-1004', before: 5, after: 10 },
        { id: 'D-1005', before: 0, after: 10 },
        { id: 'D-1007', before: 0, after: 10 },
      ]);
      expect(output.skipped).toEqual([{ id: 'D-1006', why: 'already at 10%' }]);
      expect(output.revenueImpact).toBe(-77_000);
      expect(store.history()).toHaveLength(1);
      expect(store.lastEntry()?.label).toBe('10% discount on 4 deals');
      expect(request).not.toHaveBeenCalled();
    });

    it('reports applied when every deal changes', async () => {
      setup(false);
      const output = await call('applyBatchDiscount', {
        dealIds: ['D-1005', 'D-1007'],
        discountPct: 10,
        reason: REASON,
      });
      expect(output.status).toBe('applied');
      expect(output.skipped).toEqual([]);
    });

    it('rejects more than 25 ids and leaves the store untouched', async () => {
      setup(false);
      const dealIds = Array.from({ length: 26 }, (_, i) => `D-${1001 + i}`);
      await expect(
        call('applyBatchDiscount', { dealIds, discountPct: 5, reason: REASON }),
      ).rejects.toThrow('dealIds');
      await expect(
        call('applyBatchDiscount', { dealIds: [], discountPct: 5, reason: REASON }),
      ).rejects.toThrow('dealIds');
      expect(store.entities()).toEqual(SEED_DEALS);
      expect(store.canUndo()).toBe(false);
    });

    it('rejects out-of-range discounts and malformed ids', async () => {
      setup(false);
      const base = { dealIds: ['D-1004'], reason: REASON };
      await expect(call('applyBatchDiscount', { ...base, discountPct: 51 })).rejects.toThrow();
      await expect(call('applyBatchDiscount', { ...base, discountPct: -1 })).rejects.toThrow();
      await expect(
        call('applyBatchDiscount', { dealIds: ['1004'], discountPct: 5, reason: REASON }),
      ).rejects.toThrow();
    });

    it('rejects a risky call when no approval gate exists and changes nothing', async () => {
      setup(false);
      const before = discounts();
      const output = await call<{ status: string; note: string }>('applyBatchDiscount', {
        dealIds: ['D-1002'],
        discountPct: 25,
        reason: REASON,
      });
      expect(output.status).toBe('rejected_by_human');
      expect(discounts()).toEqual(before);
      expect(store.canUndo()).toBe(false);
      expect(open).not.toHaveBeenCalled();
    });

    it('asks the gate with the policy flags, then applies on approval', async () => {
      setup(true);
      request.mockResolvedValue({ approved: true });
      const output = await call('applyBatchDiscount', {
        dealIds: ['D-1002'],
        discountPct: 20,
        reason: REASON,
      });

      expect(request).toHaveBeenCalledTimes(1);
      expect(request.mock.calls[0]?.[0]).toMatchObject({
        toolName: 'applyBatchDiscount',
        risk: 'high',
        reason: REASON,
        summary: 'Set a 20% discount on 1 deal (-$84k revenue)',
        details: {
          policy: ['Discount of 20% is above the 15% policy limit'],
          changes: [{ id: 'D-1002', before: 0, after: 20, impact: -84_000 }],
        },
      });
      expect(output.status).toBe('applied');
      expect(store.entityMap()['D-1002']?.discountPct).toBe(20);
      expect(store.history()).toHaveLength(1);
    });

    it('leaves everything unchanged when the human rejects', async () => {
      setup(true);
      request.mockResolvedValue({ approved: false, note: 'Too steep' });
      const before = discounts();
      const output = await call<{ status: string; note: string }>('applyBatchDiscount', {
        dealIds: ['D-1002'],
        discountPct: 40,
        reason: REASON,
      });
      expect(output).toEqual({ status: 'rejected_by_human', note: 'Too steep' });
      expect(discounts()).toEqual(before);
      expect(store.canUndo()).toBe(false);
    });

    it('does not ask the gate when the policy is satisfied', async () => {
      setup(true);
      await call('applyBatchDiscount', { dealIds: ['D-1002'], discountPct: 15, reason: REASON });
      expect(request).not.toHaveBeenCalled();
      expect(store.entityMap()['D-1002']?.discountPct).toBe(15);
    });

    it('reports unknown and unchanged deals as skipped and de-duplicates ids', async () => {
      setup(false);
      const output = await call('applyBatchDiscount', {
        dealIds: ['D-1002', 'D-1002', 'D-9999'],
        discountPct: 5,
        reason: REASON,
      });
      expect(output.status).toBe('partial');
      expect(output.changed).toHaveLength(1);
      expect(output.skipped).toEqual([{ id: 'D-9999', why: 'unknown deal' }]);

      const again = await call('applyBatchDiscount', {
        dealIds: ['D-1002'],
        discountPct: 5,
        reason: REASON,
      });
      expect(again).toMatchObject({
        status: 'no_change',
        changed: [],
        skipped: [{ id: 'D-1002', why: 'already at 5%' }],
        revenueImpact: 0,
      });
    });

    it('counts a discount reduction as positive revenue impact', async () => {
      setup(false);
      await call('applyBatchDiscount', { dealIds: ['D-1002'], discountPct: 10, reason: REASON });
      const output = await call('applyBatchDiscount', {
        dealIds: ['D-1002'],
        discountPct: 0,
        reason: REASON,
      });
      expect(output.revenueImpact).toBe(42_000);
    });

    it('shows a snackbar with the number of changed deals, and none for a no-op', async () => {
      setup(false);
      await call('applyBatchDiscount', {
        dealIds: EMEA_NEGOTIATION,
        discountPct: 10,
        reason: REASON,
      });
      expect(open).toHaveBeenCalledTimes(1);
      expect(open.mock.calls[0]?.[0]).toBe('Agent set a 10% discount on 3 deals');

      open.mockClear();
      await call('applyBatchDiscount', {
        dealIds: EMEA_NEGOTIATION,
        discountPct: 10,
        reason: REASON,
      });
      expect(open).not.toHaveBeenCalled();
    });

    it('restores the exact state and records a packet when the snackbar Undo is pressed', async () => {
      setup(false);
      const before = discounts();
      await call('applyBatchDiscount', { dealIds: ['D-1002'], discountPct: 5, reason: REASON });
      expect(store.entityMap()['D-1002']?.discountPct).toBe(5);
      expect(open.mock.calls[0]).toEqual([
        'Agent set a 5% discount on 1 deal',
        'Undo',
        expect.any(Object),
      ]);

      actions[0]?.next();

      expect(discounts()).toEqual(before);
      expect(store.canUndo()).toBe(false);
      const packets = TestBed.inject(WireTelemetryStore).entities();
      expect(packets.map((packet) => packet.method)).toEqual(['tools/call', 'human/undo']);
    });

    it('ignores a stale Undo press once its entry is gone', async () => {
      setup(false);
      await call('applyBatchDiscount', { dealIds: ['D-1002'], discountPct: 5, reason: REASON });
      actions[0]?.next();
      actions[0]?.next();
      const undos = TestBed.inject(WireTelemetryStore)
        .entities()
        .filter((packet) => packet.method === 'human/undo');
      expect(undos).toHaveLength(1);
    });

    it('offers Undo for stage updates as well', async () => {
      setup(false);
      await call('updateDealStages', {
        updates: [{ dealId: 'D-1002', stage: 'proposal' }],
        reason: REASON,
      });
      actions[0]?.next();
      expect(store.entityMap()['D-1002']?.stage).toBe('negotiation');
    });

    it('singularises the snackbar for one deal', async () => {
      setup(false);
      await call('applyBatchDiscount', { dealIds: ['D-1002'], discountPct: 5, reason: REASON });
      expect(open.mock.calls[0]?.[0]).toBe('Agent set a 5% discount on 1 deal');
    });
  });

  describe('updateDealStages', () => {
    const smallOpen = SEED_DEALS.find((deal) => isOpen(deal) && netValue(deal) <= 100_000);

    it('moves what it can and reports the rest as skipped', async () => {
      setup(false);
      const output = await call('updateDealStages', {
        updates: [
          { dealId: 'D-1002', stage: 'proposal' },
          { dealId: 'D-1001', stage: 'prospecting' },
          { dealId: 'D-9999', stage: 'proposal' },
          { dealId: 'D-1004', stage: 'negotiation' },
        ],
        reason: REASON,
      });

      expect(output.status).toBe('partial');
      expect(output.moved).toEqual([{ id: 'D-1002', before: 'negotiation', after: 'proposal' }]);
      expect(output.skipped).toEqual([
        { id: 'D-1001', why: 'closed deals cannot be reopened' },
        { id: 'D-9999', why: 'unknown deal' },
        { id: 'D-1004', why: 'already in negotiation' },
      ]);
      expect(store.entityMap()['D-1002']?.stage).toBe('proposal');
      expect(store.entityMap()['D-1001']?.stage).toBe('closed-won');
      expect(open.mock.calls[0]?.[0]).toBe('Agent moved 1 deal to a new stage');
    });

    it('reports no_change when nothing moves, without a snackbar', async () => {
      setup(false);
      const output = await call('updateDealStages', {
        updates: [{ dealId: 'D-1004', stage: 'negotiation' }],
        reason: REASON,
      });
      expect(output.status).toBe('no_change');
      expect(open).not.toHaveBeenCalled();
    });

    it('keeps only the last update for a deal listed twice', async () => {
      setup(false);
      const output = await call('updateDealStages', {
        updates: [
          { dealId: 'D-1002', stage: 'qualification' },
          { dealId: 'D-1002', stage: 'proposal' },
        ],
        reason: REASON,
      });
      expect(output.moved).toEqual([{ id: 'D-1002', before: 'negotiation', after: 'proposal' }]);
      expect(store.lastEntry()?.label).toBe('Stage updates on 1 deal');
    });

    it('rejects more than 25 updates and unknown stages', async () => {
      setup(false);
      const updates = Array.from({ length: 26 }, (_, i) => ({
        dealId: `D-${1001 + i}`,
        stage: 'proposal',
      }));
      await expect(call('updateDealStages', { updates, reason: REASON })).rejects.toThrow(
        'updates',
      );
      await expect(
        call('updateDealStages', {
          updates: [{ dealId: 'D-1002', stage: 'won' }],
          reason: REASON,
        }),
      ).rejects.toThrow('updates[0].stage');
      expect(store.entities()).toEqual(SEED_DEALS);
    });

    it('rejects closing a deal over $100k as lost when no gate exists', async () => {
      setup(false);
      const output = await call<{ status: string }>('updateDealStages', {
        updates: [{ dealId: 'D-1002', stage: 'closed-lost' }],
        reason: REASON,
      });
      expect(output.status).toBe('rejected_by_human');
      expect(store.entityMap()['D-1002']?.stage).toBe('negotiation');
      expect(store.canUndo()).toBe(false);
    });

    it('asks the gate and closes the deal on approval', async () => {
      setup(true);
      request.mockResolvedValue({ approved: true });
      const output = await call('updateDealStages', {
        updates: [{ dealId: 'D-1002', stage: 'closed-lost' }],
        reason: REASON,
      });
      expect(request.mock.calls[0]?.[0]).toMatchObject({
        toolName: 'updateDealStages',
        risk: 'high',
        summary: 'Mark 1 large deal as closed-lost',
        details: { deals: [{ id: 'D-1002', netValue: 420_000 }] },
      });
      expect(output.status).toBe('applied');
      expect(store.entityMap()['D-1002']).toMatchObject({ stage: 'closed-lost', probability: 0 });
    });

    it('shows every move in a mixed batch, flagged first, and commits exactly those', async () => {
      setup(true);
      request.mockResolvedValue({ approved: true });
      expect(smallOpen).toBeDefined();
      const output = await call('updateDealStages', {
        updates: [
          { dealId: smallOpen?.id, stage: 'closed-won' },
          { dealId: 'D-1002', stage: 'closed-lost' },
          { dealId: 'D-1001', stage: 'closed-lost' },
          { dealId: 'D-9999', stage: 'closed-lost' },
        ],
        reason: REASON,
      });

      const asked = request.mock.calls[0]?.[0];
      expect(asked?.summary).toBe('Mark 1 large deal as closed-lost, and apply 1 other stage move');
      expect(asked?.diff?.map((row) => row.label)).toEqual([
        expect.stringContaining('D-1002'),
        expect.stringContaining(smallOpen?.id ?? ''),
      ]);
      expect(asked?.diff?.[0]).toMatchObject({ before: 'Negotiation', after: 'Closed Lost' });
      expect(asked?.diff?.[0]?.note).toContain('Probability set to 0%');
      expect(asked?.diff?.[1]).toMatchObject({ after: 'Closed Won' });
      expect(asked?.diff?.[1]?.note).toContain('contract is activated');

      const committed = (output.moved ?? []).map((move) => move.id).sort();
      expect(committed).toEqual(
        [...(asked?.diff ?? []).map((row) => /\((D-\d+)\)/.exec(row.label)?.[1] ?? '')].sort(),
      );
      expect(output.skipped.map((entry) => entry.id).sort()).toEqual(['D-1001', 'D-9999']);
      expect(store.entityMap()['D-1001']?.stage).toBe('closed-won');
    });

    it('does not need approval for a small deal or a non-lost stage', async () => {
      setup(true);
      expect(smallOpen).toBeDefined();
      await call('updateDealStages', {
        updates: [
          { dealId: smallOpen?.id, stage: 'closed-lost' },
          { dealId: 'D-1002', stage: 'closed-won' },
        ],
        reason: REASON,
      });
      expect(request).not.toHaveBeenCalled();
      expect(store.entityMap()['D-1002']?.stage).toBe('closed-won');
    });
  });

  describe('setDealFilter', () => {
    beforeEach(() => setup(true));

    it('applies stages and regions and reports the visible count', async () => {
      const output = await call<{ applied: unknown; visibleCount: number }>('setDealFilter', {
        stages: ['negotiation'],
        regions: ['EMEA'],
      });
      expect(output.visibleCount).toBe(EMEA_NEGOTIATION.length);
      expect(output.applied).toEqual({
        ...EMPTY_FILTER,
        stages: ['negotiation'],
        regions: ['EMEA'],
      });
      expect(store.filteredDeals().map((deal) => deal.id)).toEqual(
        expect.arrayContaining(EMEA_NEGOTIATION),
      );
    });

    it('merges into the current filter and can set a minimum value and query', async () => {
      await call('setDealFilter', { regions: ['EMEA'] });
      const output = await call<{ applied: { regions: string[]; minValue: number } }>(
        'setDealFilter',
        { minValue: 300_000, query: 'bank' },
      );
      expect(output.applied).toMatchObject({ regions: ['EMEA'], minValue: 300_000, query: 'bank' });
    });

    it('clears first when asked, keeping only the newly provided fields', async () => {
      await call('setDealFilter', { regions: ['EMEA'], stages: ['negotiation'] });
      const output = await call<{ applied: unknown; visibleCount: number }>('setDealFilter', {
        clear: true,
        query: 'arcadia',
      });
      expect(output.applied).toEqual({ ...EMPTY_FILTER, query: 'arcadia' });
      expect(output.visibleCount).toBe(1);
    });

    it('resets to every deal with clear alone', async () => {
      await call('setDealFilter', { regions: ['APAC'] });
      const output = await call<{ applied: unknown; visibleCount: number }>('setDealFilter', {
        clear: true,
      });
      expect(output.applied).toEqual(EMPTY_FILTER);
      expect(output.visibleCount).toBe(SEED_DEALS.length);
    });

    it('is view-only: no snapshot, no approval, no snackbar, deals untouched', async () => {
      await call('setDealFilter', { stages: ['closed-lost'], minValue: 1 });
      expect(store.canUndo()).toBe(false);
      expect(request).not.toHaveBeenCalled();
      expect(open).not.toHaveBeenCalled();
      expect(store.entities()).toEqual(SEED_DEALS);
    });

    it('rejects unknown stages and extra properties', async () => {
      await expect(call('setDealFilter', { stages: ['won'] })).rejects.toThrow('stages[0]');
      await expect(call('setDealFilter', { reason: 'because' })).rejects.toThrow();
    });
  });
  describe('terminateContract', () => {
    const ARGS = { dealId: 'D-1001', reason: 'Customer asked to cancel' };

    it('is critical and always asks the gate, with a diff of the contract', async () => {
      setup(true);
      request.mockResolvedValue({ approved: true });
      await call('terminateContract', ARGS);

      expect(request).toHaveBeenCalledTimes(1);
      expect(request.mock.calls[0]?.[0]).toMatchObject({
        toolName: 'terminateContract',
        risk: 'critical',
        summary: 'Terminate the contract with Konkan Freight (D-1001)',
        reason: ARGS.reason,
        policy: ['Terminating a contract always needs a human decision'],
        diff: [
          {
            label: 'Konkan Freight (D-1001)',
            field: 'Contract',
            before: 'active',
            after: 'terminated',
            note: '$171k net value',
          },
        ],
      });
    });

    it('terminates on approval, snapshots, stamps the time and offers Undo', async () => {
      setup(true);
      request.mockResolvedValue({ approved: true });
      const output = await call<{ status: string; dealId: string; terminatedAt: string }>(
        'terminateContract',
        ARGS,
      );

      expect(output).toMatchObject({
        status: 'applied',
        dealId: 'D-1001',
        terminatedAt: '2026-11-09T10:00:00.000Z',
      });
      expect(store.entityMap()['D-1001']?.contractStatus).toBe('terminated');
      expect(store.lastEntry()?.label).toBe('Terminate contract D-1001');
      expect(open.mock.calls[0]?.[0]).toBe('Agent terminated the contract for D-1001');

      actions[0]?.next();
      expect(store.entityMap()['D-1001']?.contractStatus).toBe('active');
    });

    it('changes nothing and takes no snapshot when the human rejects', async () => {
      setup(true);
      request.mockResolvedValue({ approved: false, note: 'Not without legal' });
      const output = await call('terminateContract', ARGS);
      expect(output).toEqual({ status: 'rejected_by_human', note: 'Not without legal' });
      expect(store.entityMap()['D-1001']?.contractStatus).toBe('active');
      expect(store.canUndo()).toBe(false);
      expect(open).not.toHaveBeenCalled();
    });

    it('is rejected outright when no approval gate exists', async () => {
      setup(false);
      const output = await call<{ status: string }>('terminateContract', ARGS);
      expect(output.status).toBe('rejected_by_human');
      expect(store.entityMap()['D-1001']?.contractStatus).toBe('active');
    });

    it('is gated even when the deal has no active contract, and reports no_change', async () => {
      setup(true);
      request.mockResolvedValue({ approved: true });
      const output = await call<MutationOutput & { terminatedAt: string | null }>(
        'terminateContract',
        { dealId: 'D-1002', reason: ARGS.reason },
      );
      expect(request).toHaveBeenCalledTimes(1);
      expect(output).toMatchObject({
        status: 'no_change',
        terminatedAt: null,
        skipped: [{ id: 'D-1002', why: 'only closed-won deals have a contract' }],
      });
      expect(open).not.toHaveBeenCalled();
    });

    it('fails on an unknown deal without bothering the human', async () => {
      setup(true);
      await expect(
        call('terminateContract', { dealId: 'D-9999', reason: ARGS.reason }),
      ).rejects.toThrow('Unknown deal D-9999');
      expect(request).not.toHaveBeenCalled();
    });

    it('validates its input and carries the consequential hint', async () => {
      setup(true);
      await expect(call('terminateContract', { dealId: 'D-1001' })).rejects.toThrow('reason');
      await expect(call('terminateContract', { dealId: 'x', reason: ARGS.reason })).rejects.toThrow(
        'dealId',
      );
      const tool = registry.current.toolInfos().find(({ name }) => name === 'terminateContract');
      expect(tool?.annotations?.['consequentialHint']).toBe(true);
    });
  });

  describe('approval requests', () => {
    it('lists each discount change with its revenue impact', async () => {
      setup(true);
      request.mockResolvedValue({ approved: false });
      await call('applyBatchDiscount', {
        dealIds: ['D-1002', 'D-1005'],
        discountPct: 20,
        reason: REASON,
      });
      const { diff, policy } = request.mock.calls[0]?.[0] ?? {};
      expect(policy).toEqual(['Discount of 20% is above the 15% policy limit']);
      expect(diff?.map((row) => [row.label, row.before, row.after, row.note])).toEqual([
        ['Arcadia Bank (D-1002)', '0%', '20%', '-$84k'],
        [expect.stringMatching(/\(D-1005\)$/), '0%', '20%', expect.stringMatching(/^-\$/)],
      ]);
    });

    it('lists each large deal that would be closed lost with its current stage and effects', async () => {
      setup(true);
      request.mockResolvedValue({ approved: false });
      await call('updateDealStages', {
        updates: [{ dealId: 'D-1002', stage: 'closed-lost' }],
        reason: REASON,
      });
      expect(request.mock.calls[0]?.[0].diff).toEqual([
        {
          label: 'Arcadia Bank (D-1002)',
          field: 'Stage',
          before: 'Negotiation',
          after: 'Closed Lost',
          note: '$420k net value. Probability set to 0%',
        },
      ]);
    });
  });
});
