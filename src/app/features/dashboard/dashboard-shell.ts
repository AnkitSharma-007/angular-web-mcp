import { Component, inject } from '@angular/core';
import { isActive, Router, RouterLink, RouterOutlet } from '@angular/router';
import { ProposalDrawer } from '../proposal/proposal-drawer';
import { ByokBanner } from '../settings/byok-banner';
import { DashboardUiStore } from './data/dashboard-ui-store';

@Component({
  selector: 'app-dashboard-shell',
  imports: [RouterOutlet, RouterLink, ProposalDrawer, ByokBanner],
  templateUrl: './dashboard-shell.html',
  host: { class: 'flex flex-col gap-4' },
})
export class DashboardShell {
  private readonly router = inject(Router);
  protected readonly ui = inject(DashboardUiStore);

  protected readonly overviewActive = isActive('/dashboard', this.router, {
    paths: 'exact',
    queryParams: 'ignored',
  });
  protected readonly labActive = isActive('/dashboard/lab', this.router, {
    paths: 'subset',
    queryParams: 'ignored',
  });
}
