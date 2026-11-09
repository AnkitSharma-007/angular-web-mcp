import { CurrencyPipe, DecimalPipe } from '@angular/common';
import { Component, computed, inject, signal } from '@angular/core';
import { form, FormField } from '@angular/forms/signals';
import { MatButton } from '@angular/material/button';
import { MatIcon } from '@angular/material/icon';
import { CLOCK } from '../../core/util/clock';
import { GEMINI_MODELS, findModel, priceAt } from '../../mcp/agent/gemini/gemini-models';
import { GlassCard } from '../../shared/ui/glass-card/glass-card';
import { LayoutStore } from '../layout/layout-store';
import { DEFAULT_RACE_PROMPT, ModelRaceStore, type RaceEntry } from './model-race';

@Component({
  selector: 'app-race-panel',
  imports: [CurrencyPipe, DecimalPipe, FormField, GlassCard, MatButton, MatIcon],
  templateUrl: './race-panel.html',
  host: { class: 'block' },
})
export class RacePanel {
  protected readonly race = inject(ModelRaceStore);
  private readonly layout = inject(LayoutStore);
  private readonly clock = inject(CLOCK);

  protected readonly entry = signal({ prompt: DEFAULT_RACE_PROMPT });
  protected readonly promptForm = form(this.entry);

  protected readonly options = computed(() => {
    const now = this.clock();
    return GEMINI_MODELS.map((model) => ({ ...model, price: priceAt(model, now) }));
  });
  protected readonly canRun = computed(
    () => this.race.canRun() && this.entry().prompt.trim() !== '',
  );

  protected emojiOf(entry: RaceEntry): string {
    return findModel(entry.model)?.emoji ?? '';
  }

  protected personaOf(entry: RaceEntry): string {
    return findModel(entry.model)?.persona ?? entry.model;
  }

  protected run(): void {
    void this.race.run(this.entry().prompt);
  }

  protected inspect(runId: string): void {
    this.layout.showRun(runId);
  }
}
