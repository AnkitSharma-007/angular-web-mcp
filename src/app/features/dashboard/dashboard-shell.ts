import { Component, inject } from '@angular/core';
import { isActive, Router, RouterLink, RouterOutlet } from '@angular/router';

@Component({
  selector: 'app-dashboard-shell',
  imports: [RouterOutlet, RouterLink],
  templateUrl: './dashboard-shell.html',
  host: { class: 'flex flex-col gap-4' },
})
export class DashboardShell {
  private readonly router = inject(Router);

  protected readonly overviewActive = isActive('/dashboard', this.router, {
    paths: 'exact',
    queryParams: 'ignored',
  });
  protected readonly labActive = isActive('/dashboard/lab', this.router, {
    paths: 'subset',
    queryParams: 'ignored',
  });
}
