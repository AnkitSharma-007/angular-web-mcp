import { TestBed } from '@angular/core/testing';
import { MatSnackBar } from '@angular/material/snack-bar';
import type { HistoryEntry } from '../../core/store-features/with-agent-history';
import { WireTelemetryStore } from '../../mcp/telemetry/wire-telemetry-store';
import { UNDO_NOTICE_MS, UndoNotifier } from './undo-notifier';

const ENTRY: HistoryEntry = {
  id: 'h-1',
  label: '10% discount',
  at: '2026-11-09T10:00:00.000Z',
  snapshot: {},
};

describe('UndoNotifier', () => {
  afterEach(() => TestBed.inject(MatSnackBar).dismiss());

  it('shows the message in the snackbar with a dismiss action', () => {
    const ref = TestBed.inject(UndoNotifier).announce('Agent moved 3 deals to a new stage');
    TestBed.tick();
    expect(document.body.textContent).toContain('Agent moved 3 deals to a new stage');
    expect(document.body.textContent).toContain('Dismiss');
    ref.dismiss();
  });

  it('uses a timed snackbar without an undo action by default', () => {
    const snackBar = TestBed.inject(MatSnackBar);
    const open = vi.spyOn(snackBar, 'open');
    TestBed.inject(UndoNotifier).announce('hello');
    expect(open).toHaveBeenCalledWith('hello', 'Dismiss', { duration: UNDO_NOTICE_MS });
  });

  it('offers Undo, calls back when pressed and records a human/undo packet', () => {
    const onUndo = vi.fn(() => ENTRY);
    const ref = TestBed.inject(UndoNotifier).announce('Agent changed 2 deals', onUndo);
    expect(onUndo).not.toHaveBeenCalled();
    ref.dismissWithAction();
    expect(onUndo).toHaveBeenCalledTimes(1);
    const [packet] = TestBed.inject(WireTelemetryStore).entities();
    expect(packet).toMatchObject({
      channel: 'human',
      method: 'human/undo',
      status: 'ok',
      envelope: {
        request: { params: { entryId: 'h-1', label: '10% discount', source: 'snackbar' } },
        response: { result: { restored: '10% discount' } },
      },
    });
  });

  it('records nothing when the entry to restore no longer exists', () => {
    const notifier = TestBed.inject(UndoNotifier);
    notifier.announce('Agent changed 2 deals', () => null).dismissWithAction();
    notifier.recordUndo(null, 'panel');
    expect(TestBed.inject(WireTelemetryStore).entities()).toEqual([]);
  });

  it('tags a panel undo with its source', () => {
    TestBed.inject(UndoNotifier).recordUndo(ENTRY, 'panel');
    const [packet] = TestBed.inject(WireTelemetryStore).entities();
    expect(packet?.envelope.request.params).toMatchObject({ source: 'panel' });
  });
});
