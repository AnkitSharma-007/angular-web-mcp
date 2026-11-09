import { Component } from '@angular/core';
import { AgentHistoryPanel } from '../history/agent-history-panel';
import { DealsTable } from './deals-table/deals-table';
import { MetricsStrip } from './metrics-strip/metrics-strip';
import { PipelineChart } from './pipeline-chart/pipeline-chart';

@Component({
  selector: 'app-dashboard-page',
  imports: [MetricsStrip, PipelineChart, AgentHistoryPanel, DealsTable],
  templateUrl: './dashboard-page.html',
  host: { class: 'flex flex-col gap-4' },
})
export class DashboardPage {}
