import { provideExperimentalWebMcpTools } from '@angular/core';
import type { Routes } from '@angular/router';
import { ApprovalService } from './features/approvals/approval-service';
import { HUMAN_APPROVAL_GATE } from './mcp/tooling/approval-gate';
import { DEAL_CONTEXT_TOOLS } from './features/dashboard/tools/deal-context-tools';
import { DashboardUiStore } from './features/dashboard/data/dashboard-ui-store';
import { DealsStore } from './features/dashboard/data/deals-store';
import { IsolatedRunner } from './features/lab/isolated-run';
import { ProposalsStore } from './features/proposal/proposals-store';

export const routes: Routes = [
  { path: '', pathMatch: 'full', redirectTo: 'dashboard' },
  {
    path: 'dashboard',
    providers: [
      DealsStore,
      DashboardUiStore,
      ProposalsStore,
      IsolatedRunner,
      { provide: HUMAN_APPROVAL_GATE, useExisting: ApprovalService },
      provideExperimentalWebMcpTools(DEAL_CONTEXT_TOOLS),
    ],
    loadComponent: () =>
      import('./features/dashboard/dashboard-shell').then((m) => m.DashboardShell),
    children: [
      {
        path: '',
        loadComponent: () =>
          import('./features/dashboard/dashboard-page').then((m) => m.DashboardPage),
      },
      {
        path: 'lab',
        loadComponent: () => import('./features/lab/lab-page').then((m) => m.LabPage),
      },
    ],
  },
  {
    path: 'about',
    loadComponent: () => import('./features/about/about-page').then((m) => m.AboutPage),
  },
  { path: '**', redirectTo: 'dashboard' },
];
