import { Component, inject } from '@angular/core';
import { CompactCurrencyPipe } from '../../../shared/pipes/compact-currency';
import { StatTile } from '../../../shared/ui/stat-tile/stat-tile';
import { DealsStore } from '../data/deals-store';

@Component({
  selector: 'app-metrics-strip',
  imports: [StatTile, CompactCurrencyPipe],
  templateUrl: './metrics-strip.html',
  host: { class: 'block' },
})
export class MetricsStrip {
  protected readonly store = inject(DealsStore);
}
