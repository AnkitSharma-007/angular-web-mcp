import { ApplicationRef } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { MatDialog } from '@angular/material/dialog';
import { MatSnackBar } from '@angular/material/snack-bar';
import { SEED_DEALS } from '../../core/data/seed-deals';
import { HUMAN_APPROVAL_GATE } from '../../mcp/tooling/approval-gate';
import { WireTelemetryStore } from '../../mcp/telemetry/wire-telemetry-store';
import { useFakeModelContext } from '../../../testing/test-providers';
import { DealsStore } from '../dashboard/data/deals-store';
import { ApprovalService } from './approval-service';

const REASON = 'Quarter-end push';

describe('approval gating end to end', () => {
  const registry = useFakeModelContext();
  let store: InstanceType<typeof DealsStore>;
  let service: ApprovalService;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [DealsStore, { provide: HUMAN_APPROVAL_GATE, useExisting: ApprovalService }],
    });
    store = TestBed.inject(DealsStore);
    service = TestBed.inject(ApprovalService);
  });

  afterEach(() => {
    TestBed.inject(MatDialog).closeAll();
    TestBed.inject(MatSnackBar).dismiss();
  });

  const execute = (name: string, args: Record<string, unknown>, signal?: AbortSignal) =>
    registry.current.executeTool(name, args, signal ? { signal } : {}) as Promise<{
      content: { text: string }[];
    }>;

  const parse = (result: { content: { text: string }[] }) =>
    JSON.parse(result.content[0]?.text ?? 'null') as { status: string; note?: string };

  async function dialog() {
    await vi.waitFor(() => {
      TestBed.inject(ApplicationRef).tick();
      expect(document.querySelector('app-approval-dialog')).not.toBeNull();
    });
    return document.querySelector('app-approval-dialog') as HTMLElement;
  }

  async function press(testId: 'approve' | 'reject') {
    const shown = await dialog();
    document.querySelector<HTMLButtonElement>(`[data-testid="${testId}"]`)?.click();
    await vi.waitFor(() => expect(document.contains(shown)).toBe(false));
  }

  it('skips the gate for a call within policy', async () => {
    const request = vi.spyOn(service, 'request');
    await execute('applyBatchDiscount', { dealIds: ['D-1002'], discountPct: 10, reason: REASON });
    expect(request).not.toHaveBeenCalled();
    expect(store.entityMap()['D-1002']?.discountPct).toBe(10);
  });

  it('pauses a risky call on the dialog, then runs and snapshots on approval', async () => {
    const call = execute('applyBatchDiscount', {
      dealIds: ['D-1002'],
      discountPct: 25,
      reason: REASON,
    });
    const shown = await dialog();
    expect(shown.textContent).toContain('Set a 25% discount on 1 deal');
    expect(shown.textContent).toContain(REASON);
    expect(service.pending()?.toolName).toBe('applyBatchDiscount');
    expect(store.entityMap()['D-1002']?.discountPct).toBe(0);
    expect(store.canUndo()).toBe(false);

    await press('approve');

    expect(parse(await call)).toMatchObject({ status: 'applied' });
    expect(store.entityMap()['D-1002']?.discountPct).toBe(25);
    expect(store.history()).toHaveLength(1);
  });

  it('returns rejected_by_human with the note and leaves the store untouched on reject', async () => {
    const call = execute('applyBatchDiscount', {
      dealIds: ['D-1002'],
      discountPct: 25,
      reason: REASON,
    });
    await dialog();
    const note = document.querySelector<HTMLTextAreaElement>('textarea');
    note!.value = 'Too steep';
    note!.dispatchEvent(new Event('input'));
    await press('reject');

    expect(parse(await call)).toEqual({ status: 'rejected_by_human', note: 'Too steep' });
    expect(store.entities()).toEqual(SEED_DEALS);
    expect(store.canUndo()).toBe(false);
  });

  it('gates terminateContract from an external agent, as critical', async () => {
    const call = execute('terminateContract', {
      dealId: 'D-1001',
      reason: 'Customer asked to cancel',
    });
    const shown = await dialog();
    expect(shown.textContent).toContain('Critical action');
    expect(shown.textContent).toContain('Konkan Freight (D-1001)');
    await press('reject');
    expect(parse(await call).status).toBe('rejected_by_human');
    expect(store.entityMap()['D-1001']?.contractStatus).toBe('active');
  });

  it('turns an aborted agent run into a rejection with the note "aborted"', async () => {
    const controller = new AbortController();
    const call = execute(
      'updateDealStages',
      { updates: [{ dealId: 'D-1002', stage: 'closed-lost' }], reason: REASON },
      controller.signal,
    );
    await dialog();
    controller.abort();

    expect(parse(await call)).toEqual({ status: 'rejected_by_human', note: 'aborted' });
    expect(store.entityMap()['D-1002']?.stage).toBe('negotiation');
    expect(store.canUndo()).toBe(false);
    await vi.waitFor(() => {
      TestBed.inject(ApplicationRef).tick();
      expect(document.querySelector('app-approval-dialog')).toBeNull();
    });
  });

  it('serves two risky calls one dialog at a time and records wait packets for both', async () => {
    const first = execute('applyBatchDiscount', {
      dealIds: ['D-1002'],
      discountPct: 25,
      reason: REASON,
    });
    const second = execute('terminateContract', { dealId: 'D-1001', reason: REASON });
    expect((await dialog()).textContent).toContain('25% discount');
    await press('approve');
    expect((await dialog()).textContent).toContain('Terminate the contract');
    await press('approve');

    expect(parse(await first).status).toBe('applied');
    expect(parse(await second).status).toBe('applied');
    const methods = TestBed.inject(WireTelemetryStore)
      .entities()
      .map((packet) => packet.method);
    expect(methods.filter((method) => method === 'hitl/requested')).toHaveLength(2);
    expect(methods.filter((method) => method === 'hitl/resolved')).toHaveLength(2);
    expect(store.history().map((entry) => entry.label)).toEqual([
      '25% discount on 1 deal',
      'Terminate contract D-1001',
    ]);
  });

  it('lets an auto-decider answer in eval mode without any dialog', async () => {
    service.setAutoDecider((req) => ({ approved: req.risk !== 'critical', note: 'eval' }));
    const discount = await execute('applyBatchDiscount', {
      dealIds: ['D-1002'],
      discountPct: 25,
      reason: REASON,
    });
    const terminate = await execute('terminateContract', { dealId: 'D-1001', reason: REASON });
    expect(parse(discount).status).toBe('applied');
    expect(parse(terminate)).toEqual({ status: 'rejected_by_human', note: 'eval' });
    expect(document.querySelector('app-approval-dialog')).toBeNull();
  });
});
