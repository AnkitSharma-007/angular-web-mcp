import { Service, inject } from '@angular/core';
import {
  MatSnackBar,
  type MatSnackBarRef,
  type TextOnlySnackBar,
} from '@angular/material/snack-bar';

export const UNDO_NOTICE_MS = 8000;

@Service()
export class UndoNotifier {
  private readonly snackBar = inject(MatSnackBar);

  announce(message: string, onUndo?: () => void): MatSnackBarRef<TextOnlySnackBar> {
    const ref = this.snackBar.open(message, onUndo ? 'Undo' : 'Dismiss', {
      duration: UNDO_NOTICE_MS,
    });
    if (onUndo) {
      ref.onAction().subscribe(onUndo);
    }
    return ref;
  }
}
