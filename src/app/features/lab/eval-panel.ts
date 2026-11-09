import { CurrencyPipe, DecimalPipe, PercentPipe } from '@angular/common';
import { Component, inject, signal } from '@angular/core';
import { form, FormField } from '@angular/forms/signals';
import { MatButton } from '@angular/material/button';
import { MatIcon } from '@angular/material/icon';
import { GlassCard } from '../../shared/ui/glass-card/glass-card';
import { LayoutStore } from '../layout/layout-store';
import { ACT_EVALS } from './act-evals';
import { copyText, downloadText } from './download-text';
import { EvalSessionStore, RUNS_PER_ACT_OPTIONS } from './eval-session';

@Component({
  selector: 'app-eval-panel',
  imports: [CurrencyPipe, DecimalPipe, FormField, GlassCard, MatButton, MatIcon, PercentPipe],
  templateUrl: './eval-panel.html',
  host: { class: 'block' },
})
export class EvalPanel {
  protected readonly session = inject(EvalSessionStore);
  private readonly layout = inject(LayoutStore);

  protected readonly acts = ACT_EVALS;
  protected readonly runOptions = RUNS_PER_ACT_OPTIONS;

  protected readonly entry = signal({ change: '' });
  protected readonly changeForm = form(this.entry);
  protected readonly logRows = signal<string[]>([]);
  protected readonly copied = signal(false);

  protected run(): void {
    this.logRows.set([]);
    this.copied.set(false);
    void this.session.run();
  }

  protected inspect(runId: string): void {
    this.layout.showRun(runId);
  }

  protected exportJson(): void {
    downloadText('act-evals.json', this.session.exportJson());
  }

  protected buildLogRows(): void {
    this.logRows.set(this.session.logRows(this.entry().change));
    this.copied.set(false);
  }

  protected async copyLogRows(): Promise<void> {
    this.copied.set(await copyText(this.logRows().join('\n')));
  }
}
