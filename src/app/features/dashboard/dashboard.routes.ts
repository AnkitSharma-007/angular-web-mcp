import { provideExperimentalWebMcpTools } from '@angular/core';
import { provideExperimentalWebMcpForms } from '@angular/forms/signals';
import type { Routes } from '@angular/router';
import { HUMAN_APPROVAL_GATE } from '../../mcp/tooling/approval-gate';
import { ApprovalService } from '../approvals/approval-service';
import { IsolatedRunner } from '../lab/isolated-run';
import { ProposalsStore } from '../proposal/proposals-store';
import { DashboardUiStore } from './data/dashboard-ui-store';
import { DealsStore } from './data/deals-store';
import { DEAL_CONTEXT_TOOLS } from './tools/deal-context-tools';

export const DASHBOARD_ROUTES: Routes = [
  {
    path: '',
    providers: [
      DealsStore,
      DashboardUiStore,
      ProposalsStore,
      IsolatedRunner,
      { provide: HUMAN_APPROVAL_GATE, useExisting: ApprovalService },
      provideExperimentalWebMcpForms(),
      provideExperimentalWebMcpTools(DEAL_CONTEXT_TOOLS),
    ],
    loadComponent: () => import('./dashboard-shell').then((m) => m.DashboardShell),
    children: [
      {
        path: '',
        loadComponent: () => import('./dashboard-page').then((m) => m.DashboardPage),
      },
      {
        path: 'lab',
        loadComponent: () => import('../lab/lab-page').then((m) => m.LabPage),
      },
    ],
  },
];
