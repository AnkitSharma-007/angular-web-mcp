import { Component } from '@angular/core';
import { DealsTable } from './deals-table/deals-table';
import { MetricsStrip } from './metrics-strip/metrics-strip';

@Component({
  selector: 'app-dashboard-page',
  imports: [MetricsStrip, DealsTable],
  templateUrl: './dashboard-page.html',
  host: { class: 'flex flex-col gap-4' },
})
export class DashboardPage {}
