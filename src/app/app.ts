import { Component, inject } from '@angular/core';
import { MatIconButton } from '@angular/material/button';
import { MatIcon } from '@angular/material/icon';
import { MatToolbar } from '@angular/material/toolbar';
import { isActive, Router, RouterLink, RouterOutlet } from '@angular/router';
import { ThemeService } from './core/services/theme';
import { REGISTRY_KIND } from './mcp/registry/registry-kind';

@Component({
  selector: 'app-root',
  imports: [RouterOutlet, RouterLink, MatToolbar, MatIconButton, MatIcon],
  templateUrl: './app.html',
})
export class App {
  protected readonly title = 'Angular Web MCP';
  protected readonly theme = inject(ThemeService);
  protected readonly registryKind = inject(REGISTRY_KIND);
  private readonly router = inject(Router);

  protected readonly dashboardActive = isActive('/dashboard', this.router, {
    paths: 'subset',
    queryParams: 'ignored',
  });
  protected readonly aboutActive = isActive('/about', this.router, {
    paths: 'exact',
    queryParams: 'ignored',
  });
}
