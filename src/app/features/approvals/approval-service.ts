import { Injector, Service, inject, signal } from '@angular/core';
import type { MatDialogRef } from '@angular/material/dialog';
import { firstValueFrom } from 'rxjs';
import { CLOCK } from '../../core/util/clock';
import type {
  ApprovalDecision,
  ApprovalRequest,
  HumanApprovalGate,
} from '../../mcp/tooling/approval-gate';
import { WireTelemetryStore } from '../../mcp/telemetry/wire-telemetry-store';
import type { ApprovalDialog } from './approval-dialog';

export type AutoDecider = (
  request: ApprovalRequest,
) => ApprovalDecision | Promise<ApprovalDecision>;

export const ABORTED_NOTE = 'aborted';

interface QueuedRequest {
  id: number;
  request: ApprovalRequest;
  signal: AbortSignal;
  requestedAt: number;
  resolve: (decision: ApprovalDecision) => void;
  onAbort: () => void;
  dialogRef?: MatDialogRef<ApprovalDialog, ApprovalDecision>;
  settled: boolean;
}

@Service()
export class ApprovalService implements HumanApprovalGate {
  private readonly injector = inject(Injector);
  private readonly telemetry = inject(WireTelemetryStore);
  private readonly clock = inject(CLOCK);

  private readonly current = signal<ApprovalRequest | null>(null);
  private readonly waiting = signal(0);
  private readonly queue: QueuedRequest[] = [];
  private active: QueuedRequest | null = null;
  private autoDecider: AutoDecider | null = null;
  private sequence = 0;

  readonly pending = this.current.asReadonly();
  readonly queued = this.waiting.asReadonly();

  setAutoDecider(decider: AutoDecider | null): void {
    this.autoDecider = decider;
  }

  request(request: ApprovalRequest, signal: AbortSignal): Promise<ApprovalDecision> {
    if (signal.aborted) {
      return Promise.resolve({ approved: false, note: ABORTED_NOTE });
    }
    return new Promise((resolve) => {
      const entry: QueuedRequest = {
        id: ++this.sequence,
        request,
        signal,
        requestedAt: this.clock().getTime(),
        resolve,
        onAbort: () => this.abort(entry),
        settled: false,
      };
      signal.addEventListener('abort', entry.onAbort, { once: true });
      this.telemetry.record(
        {
          channel: 'hitl',
          method: 'hitl/requested',
          correlationId: this.correlationId(entry),
          params: {
            toolName: request.toolName,
            risk: request.risk,
            summary: request.summary,
            ...(request.reason !== undefined && { reason: request.reason }),
          },
        },
        { status: 'ok', result: { position: this.queue.length + (this.active ? 1 : 0) } },
      );
      this.queue.push(entry);
      this.waiting.set(this.queue.length);
      this.pump();
    });
  }

  private pump(): void {
    const entry = this.active ? undefined : this.queue.shift();
    if (!entry) {
      return;
    }
    this.waiting.set(this.queue.length);
    this.active = entry;
    this.current.set(entry.request);
    this.decide(entry).then(
      (decision) => this.finish(entry, decision),
      (error: unknown) =>
        this.finish(entry, {
          approved: false,
          note: error instanceof Error ? error.message : String(error),
        }),
    );
  }

  private async decide(entry: QueuedRequest): Promise<ApprovalDecision> {
    if (this.autoDecider) {
      return this.autoDecider(entry.request);
    }
    const [{ MatDialog }, { ApprovalDialog }] = await Promise.all([
      import('@angular/material/dialog'),
      import('./approval-dialog'),
    ]);
    if (entry.settled) {
      return { approved: false, note: ABORTED_NOTE };
    }
    entry.dialogRef = this.injector
      .get(MatDialog)
      .open<ApprovalDialog, ApprovalRequest, ApprovalDecision>(ApprovalDialog, {
        data: entry.request,
        disableClose: true,
        role: 'alertdialog',
        width: '40rem',
        maxWidth: '95vw',
      });
    const decision = await firstValueFrom(entry.dialogRef.afterClosed());
    return decision ?? { approved: false, note: 'dismissed' };
  }

  private abort(entry: QueuedRequest): void {
    const index = this.queue.indexOf(entry);
    if (index >= 0) {
      this.queue.splice(index, 1);
      this.waiting.set(this.queue.length);
    }
    entry.dialogRef?.close();
    this.finish(entry, { approved: false, note: ABORTED_NOTE });
  }

  private finish(entry: QueuedRequest, decision: ApprovalDecision): void {
    if (entry.settled) {
      return;
    }
    entry.settled = true;
    entry.signal.removeEventListener('abort', entry.onAbort);
    const waitMs = this.clock().getTime() - entry.requestedAt;
    this.telemetry.record(
      {
        channel: 'hitl',
        method: 'hitl/resolved',
        correlationId: this.correlationId(entry),
        params: { toolName: entry.request.toolName },
      },
      {
        status: decision.approved ? 'ok' : 'rejected',
        latencyMs: waitMs,
        result: {
          approved: decision.approved,
          waitMs,
          ...(decision.note !== undefined && { note: decision.note }),
        },
      },
    );
    entry.resolve(decision);
    if (this.active === entry) {
      this.active = null;
      this.current.set(null);
      this.pump();
    }
  }

  private correlationId(entry: QueuedRequest): string {
    return `hitl-${entry.id}`;
  }
}
