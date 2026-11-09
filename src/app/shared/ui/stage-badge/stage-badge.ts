import { Component, computed, input } from '@angular/core';
import { DEAL_STAGE_LABELS, type DealStage } from '../../../core/models/deal';

const STAGE_CLASSES: Record<DealStage, string> = {
  prospecting: 'bg-on-surface/10 text-on-surface-variant',
  qualification: 'bg-primary/10 text-primary',
  proposal: 'bg-primary/20 text-primary',
  negotiation: 'bg-primary text-on-primary',
  'closed-won': 'bg-success/15 text-success',
  'closed-lost': 'bg-error/15 text-error',
};

@Component({
  selector: 'app-stage-badge',
  templateUrl: './stage-badge.html',
  host: {
    class:
      'inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium whitespace-nowrap',
    '[class]': 'stageClass()',
    '[attr.data-stage]': 'stage()',
  },
})
export class StageBadge {
  readonly stage = input.required<DealStage>();

  protected readonly label = computed(() => DEAL_STAGE_LABELS[this.stage()]);
  protected readonly stageClass = computed(() => STAGE_CLASSES[this.stage()]);
}
