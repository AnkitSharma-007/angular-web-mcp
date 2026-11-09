import { TestBed } from '@angular/core/testing';
import { MatSnackBar } from '@angular/material/snack-bar';
import { UNDO_NOTICE_MS, UndoNotifier } from './undo-notifier';

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

  it('offers Undo and calls back when the action is pressed', () => {
    const onUndo = vi.fn();
    const ref = TestBed.inject(UndoNotifier).announce('Agent changed 2 deals', onUndo);
    expect(onUndo).not.toHaveBeenCalled();
    ref.dismissWithAction();
    expect(onUndo).toHaveBeenCalledTimes(1);
  });
});
