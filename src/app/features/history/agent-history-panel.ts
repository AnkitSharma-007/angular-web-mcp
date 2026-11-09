import { DatePipe } from '@angular/common';
import { Component, computed, inject } from '@angular/core';
import { MatButton } from '@angular/material/button';
import { MatIcon } from '@angular/material/icon';
import { DealsStore } from '../dashboard/data/deals-store';
import { UndoNotifier } from './undo-notifier';

@Component({
  selector: 'app-agent-history-panel',
  imports: [DatePipe, MatButton, MatIcon],
  templateUrl: './agent-history-panel.html',
  host: { class: 'block' },
})
export class AgentHistoryPanel {
  protected readonly store = inject(DealsStore);
  private readonly notifier = inject(UndoNotifier);

  protected readonly entries = computed(() => [...this.store.history()].reverse());

  protected undoTo(id: string): void {
    this.notifier.recordUndo(this.store.undoTo(id), 'panel');
  }
}
