import { Service, inject } from '@angular/core';
import {
  MatSnackBar,
  type MatSnackBarRef,
  type TextOnlySnackBar,
} from '@angular/material/snack-bar';
import type { HistoryEntry } from '../../core/store-features/with-agent-history';
import { WireTelemetryStore } from '../../mcp/telemetry/wire-telemetry-store';

export const UNDO_NOTICE_MS = 8000;

export type UndoSource = 'snackbar' | 'panel';

@Service()
export class UndoNotifier {
  private readonly snackBar = inject(MatSnackBar);
  private readonly telemetry = inject(WireTelemetryStore);

  announce(message: string, onUndo?: () => HistoryEntry | null): MatSnackBarRef<TextOnlySnackBar> {
    const ref = this.snackBar.open(message, onUndo ? 'Undo' : 'Dismiss', {
      duration: UNDO_NOTICE_MS,
    });
    if (onUndo) {
      ref.onAction().subscribe(() => this.recordUndo(onUndo(), 'snackbar'));
    }
    return ref;
  }

  recordUndo(entry: HistoryEntry | null, source: UndoSource): void {
    if (entry) {
      this.telemetry.record(
        {
          channel: 'human',
          method: 'human/undo',
          params: { entryId: entry.id, label: entry.label, source },
        },
        { status: 'ok', result: { restored: entry.label } },
      );
    }
  }
}
