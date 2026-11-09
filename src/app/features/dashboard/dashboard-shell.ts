import { Component, DestroyRef, inject } from '@angular/core';
import { isActive, Router, RouterLink, RouterOutlet } from '@angular/router';
import { AgentConsole } from '../agent-console/agent-console';
import { PresenterActions } from '../agent-console/presenter-actions';
import { LayoutStore } from '../layout/layout-store';
import { ProposalDrawer } from '../proposal/proposal-drawer';
import { ProposalsStore } from '../proposal/proposals-store';
import { ByokBanner } from '../settings/byok-banner';
import { DashboardUiStore } from './data/dashboard-ui-store';
import { DealsStore } from './data/deals-store';

@Component({
  selector: 'app-dashboard-shell',
  imports: [RouterOutlet, RouterLink, ProposalDrawer, ByokBanner, AgentConsole],
  templateUrl: './dashboard-shell.html',
  host: { class: 'flex flex-col gap-4' },
})
export class DashboardShell {
  private readonly router = inject(Router);
  private readonly deals = inject(DealsStore);
  private readonly proposals = inject(ProposalsStore);
  protected readonly ui = inject(DashboardUiStore);
  protected readonly layout = inject(LayoutStore);

  protected readonly overviewActive = isActive('/dashboard', this.router, {
    paths: 'exact',
    queryParams: 'ignored',
  });
  protected readonly labActive = isActive('/dashboard/lab', this.router, {
    paths: 'subset',
    queryParams: 'ignored',
  });

  constructor() {
    const unregister = inject(PresenterActions).registerReset(() => this.resetDemo());
    inject(DestroyRef).onDestroy(unregister);
  }

  private resetDemo(): void {
    this.ui.closeProposal();
    this.ui.selectDeal(null);
    this.deals.reset();
    this.deals.clearHistory();
    this.proposals.clearDrafts();
  }
}
