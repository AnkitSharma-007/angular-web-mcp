import { ApplicationRef } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { MatDialog } from '@angular/material/dialog';
import { CLOCK } from '../../core/util/clock';
import type { ApprovalRequest } from '../../mcp/tooling/approval-gate';
import { WireTelemetryStore } from '../../mcp/telemetry/wire-telemetry-store';
import { ABORTED_NOTE, ApprovalService } from './approval-service';

const REQUEST: ApprovalRequest = {
  toolName: 'applyBatchDiscount',
  risk: 'high',
  summary: 'Set a 20% discount on 1 deal',
  reason: 'Quarter-end push',
};
const CRITICAL: ApprovalRequest = { ...REQUEST, toolName: 'terminateContract', risk: 'critical' };

let now = 0;

function setup() {
  now = 1_000;
  TestBed.configureTestingModule({
    providers: [{ provide: CLOCK, useValue: () => new Date(now) }],
  });
  return {
    service: TestBed.inject(ApprovalService),
    telemetry: TestBed.inject(WireTelemetryStore),
  };
}

const dialogs = () => [...document.querySelectorAll('app-approval-dialog')];

async function dialogOpen(summary?: string) {
  await vi.waitFor(() => {
    TestBed.inject(ApplicationRef).tick();
    const open = dialogs();
    expect(open).toHaveLength(1);
    if (summary) {
      expect(open[0]?.textContent).toContain(summary);
    }
  });
}

async function press(testId: 'approve' | 'reject') {
  const shown = dialogs()[0];
  document.querySelector<HTMLButtonElement>(`[data-testid="${testId}"]`)?.click();
  await vi.waitFor(() => expect(document.contains(shown ?? null)).toBe(false));
}

describe('ApprovalService', () => {
  afterEach(() => TestBed.inject(MatDialog).closeAll());

  it('opens a dialog for a request and exposes it as pending until decided', async () => {
    const { service } = setup();
    expect(service.pending()).toBeNull();

    const decision = service.request(REQUEST, new AbortController().signal);
    await dialogOpen('Set a 20% discount');
    expect(service.pending()).toBe(REQUEST);

    await press('approve');
    expect(await decision).toEqual({ approved: true });
    expect(service.pending()).toBeNull();
  });

  it('returns a rejection', async () => {
    const { service } = setup();
    const decision = service.request(REQUEST, new AbortController().signal);
    await dialogOpen();
    await press('reject');
    expect(await decision).toEqual({ approved: false });
  });

  it('shows one dialog at a time and serves concurrent requests in FIFO order', async () => {
    const { service } = setup();
    const signal = new AbortController().signal;
    const first = service.request({ ...REQUEST, summary: 'first' }, signal);
    const second = service.request({ ...REQUEST, summary: 'second' }, signal);
    const third = service.request({ ...REQUEST, summary: 'third' }, signal);
    const order: string[] = [];
    void first.then(() => order.push('first'));
    void second.then(() => order.push('second'));
    void third.then(() => order.push('third'));

    await dialogOpen('first');
    expect(service.queued()).toBe(2);
    await press('approve');

    await dialogOpen('second');
    expect(service.pending()?.summary).toBe('second');
    expect(service.queued()).toBe(1);
    await press('reject');

    await dialogOpen('third');
    await press('approve');

    expect(await Promise.all([first, second, third])).toEqual([
      { approved: true },
      { approved: false },
      { approved: true },
    ]);
    expect(order).toEqual(['first', 'second', 'third']);
    expect(service.queued()).toBe(0);
  });

  it('records requested and resolved packets with the human wait time', async () => {
    const { service, telemetry } = setup();
    const decision = service.request(REQUEST, new AbortController().signal);
    await dialogOpen();
    now += 4_200;
    await press('approve');
    await decision;

    const [requested, resolved] = telemetry.entities();
    expect(requested).toMatchObject({
      channel: 'hitl',
      method: 'hitl/requested',
      status: 'ok',
      envelope: {
        request: {
          params: { toolName: 'applyBatchDiscount', risk: 'high', reason: 'Quarter-end push' },
        },
      },
    });
    expect(resolved).toMatchObject({
      channel: 'hitl',
      method: 'hitl/resolved',
      status: 'ok',
      latencyMs: 4_200,
      envelope: { response: { result: { approved: true, waitMs: 4_200 } } },
    });
    expect(resolved?.correlationId).toBe(requested?.correlationId);
    expect(telemetry.stats().calls).toBe(0);
  });

  it('marks a rejection as rejected and keeps the human note', async () => {
    const { service, telemetry } = setup();
    const decision = service.request(REQUEST, new AbortController().signal);
    await dialogOpen();
    const input = document.querySelector<HTMLTextAreaElement>('textarea');
    input!.value = 'Too steep';
    input!.dispatchEvent(new Event('input'));
    await press('reject');

    expect(await decision).toEqual({ approved: false, note: 'Too steep' });
    expect(telemetry.entities().at(-1)).toMatchObject({
      status: 'rejected',
      envelope: { response: { result: { approved: false, note: 'Too steep' } } },
    });
  });

  it('resolves an already aborted signal immediately, without a dialog or packet', async () => {
    const { service, telemetry } = setup();
    const controller = new AbortController();
    controller.abort();
    expect(await service.request(REQUEST, controller.signal)).toEqual({
      approved: false,
      note: ABORTED_NOTE,
    });
    expect(dialogs()).toHaveLength(0);
    expect(telemetry.entities()).toEqual([]);
  });

  it('closes the open dialog and moves on when the active request is aborted', async () => {
    const { service, telemetry } = setup();
    const controller = new AbortController();
    const first = service.request({ ...REQUEST, summary: 'first' }, controller.signal);
    const second = service.request({ ...REQUEST, summary: 'second' }, new AbortController().signal);
    await dialogOpen('first');

    controller.abort();
    expect(await first).toEqual({ approved: false, note: ABORTED_NOTE });

    await vi.waitFor(() => {
      TestBed.inject(ApplicationRef).tick();
      expect(dialogs().map((el) => el.textContent)).toEqual([expect.stringContaining('second')]);
    });
    expect(service.pending()?.summary).toBe('second');
    await press('approve');
    expect(await second).toEqual({ approved: true });
    expect(telemetry.entities().filter((p) => p.method === 'hitl/resolved')).toHaveLength(2);
  });

  it('drops a queued request that is aborted before its turn', async () => {
    const { service } = setup();
    const controller = new AbortController();
    const first = service.request({ ...REQUEST, summary: 'first' }, new AbortController().signal);
    const queued = service.request({ ...REQUEST, summary: 'queued' }, controller.signal);
    await dialogOpen('first');
    expect(service.queued()).toBe(1);

    controller.abort();
    expect(await queued).toEqual({ approved: false, note: ABORTED_NOTE });
    expect(service.queued()).toBe(0);
    expect(service.pending()?.summary).toBe('first');

    await press('approve');
    expect(await first).toEqual({ approved: true });
    expect(dialogs()).toHaveLength(0);
  });

  it('treats a dialog closed without a decision as a rejection', async () => {
    const { service } = setup();
    const decision = service.request(REQUEST, new AbortController().signal);
    await dialogOpen();
    TestBed.inject(MatDialog).closeAll();
    expect(await decision).toEqual({ approved: false, note: 'dismissed' });
    expect(service.pending()).toBeNull();
  });

  describe('auto-decider', () => {
    it('decides without opening a dialog, still queueing and recording packets', async () => {
      const { service, telemetry } = setup();
      const decider = vi.fn().mockResolvedValue({ approved: true, note: 'eval' });
      service.setAutoDecider(decider);

      const decision = await service.request(CRITICAL, new AbortController().signal);

      expect(decision).toEqual({ approved: true, note: 'eval' });
      expect(decider).toHaveBeenCalledExactlyOnceWith(CRITICAL);
      expect(dialogs()).toHaveLength(0);
      expect(telemetry.entities().map((packet) => packet.method)).toEqual([
        'hitl/requested',
        'hitl/resolved',
      ]);
      expect(service.pending()).toBeNull();
    });

    it('accepts a synchronous decider and can be removed again', async () => {
      const { service } = setup();
      service.setAutoDecider(() => ({ approved: false, note: 'policy' }));
      expect(await service.request(REQUEST, new AbortController().signal)).toEqual({
        approved: false,
        note: 'policy',
      });

      service.setAutoDecider(null);
      const decision = service.request(REQUEST, new AbortController().signal);
      await dialogOpen();
      await press('approve');
      expect(await decision).toEqual({ approved: true });
    });

    it('rejects with the error message when the decider fails', async () => {
      const { service } = setup();
      service.setAutoDecider(() => Promise.reject(new Error('judge unavailable')));
      expect(await service.request(REQUEST, new AbortController().signal)).toEqual({
        approved: false,
        note: 'judge unavailable',
      });
      service.setAutoDecider(() => Promise.reject('plain'));
      expect(await service.request(REQUEST, new AbortController().signal)).toEqual({
        approved: false,
        note: 'plain',
      });
    });

    it('lets an abort win over a slow decider', async () => {
      const { service } = setup();
      service.setAutoDecider(() => new Promise(() => undefined));
      const controller = new AbortController();
      const decision = service.request(REQUEST, controller.signal);
      expect(service.pending()).toBe(REQUEST);
      controller.abort();
      expect(await decision).toEqual({ approved: false, note: ABORTED_NOTE });
      expect(service.pending()).toBeNull();
    });
  });
});
