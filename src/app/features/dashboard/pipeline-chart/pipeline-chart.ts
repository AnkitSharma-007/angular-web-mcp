import { Component, computed, inject } from '@angular/core';
import { DEAL_STAGE_LABELS, type DealStage } from '../../../core/models/deal';
import { CompactCurrencyPipe } from '../../../shared/pipes/compact-currency';
import { GlassCard } from '../../../shared/ui/glass-card/glass-card';
import { DealsStore } from '../data/deals-store';

const STAGE_FILLS: Readonly<Record<DealStage, string>> = {
  prospecting: 'fill-on-surface-variant/50',
  qualification: 'fill-primary/40',
  proposal: 'fill-primary/65',
  negotiation: 'fill-primary',
  'closed-won': 'fill-success',
  'closed-lost': 'fill-error',
};

export interface StageBar {
  key: DealStage;
  label: string;
  fill: string;
  x: number;
  width: number;
  count: number;
  netValue: number;
  pct: number;
}

@Component({
  selector: 'app-pipeline-chart',
  imports: [GlassCard, CompactCurrencyPipe],
  templateUrl: './pipeline-chart.html',
  host: { class: 'block' },
})
export class PipelineChart {
  private readonly store = inject(DealsStore);

  protected readonly bars = computed<StageBar[]>(() => {
    let x = 0;
    return this.store.pipelineByStage().map(({ key, count, netValue, pct }) => {
      const bar: StageBar = {
        key,
        label: DEAL_STAGE_LABELS[key],
        fill: STAGE_FILLS[key],
        x,
        width: pct,
        count,
        netValue,
        pct,
      };
      x += pct;
      return bar;
    });
  });

  protected readonly regions = this.store.byRegion;
  protected readonly isEmpty = computed(() => this.bars().every((bar) => bar.netValue === 0));
  protected readonly summary = computed(() =>
    this.isEmpty()
      ? 'Pipeline distribution by stage: no pipeline value'
      : `Pipeline distribution by stage: ${this.bars()
          .map((bar) => `${bar.label} ${bar.pct}%`)
          .join(', ')}`,
  );
}
