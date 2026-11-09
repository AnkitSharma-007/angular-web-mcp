import { Component, inject } from '@angular/core';
import { MatIconButton } from '@angular/material/button';
import { MatIcon } from '@angular/material/icon';
import { MatToolbar } from '@angular/material/toolbar';
import { isActive, Router, RouterLink, RouterOutlet } from '@angular/router';
import { ThemeService } from './core/services/theme';
import { ApiKeyDialogLauncher } from './features/settings/api-key-dialog-launcher';
import { SettingsStore } from './features/settings/settings-store';
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
  protected readonly settings = inject(SettingsStore);
  private readonly router = inject(Router);
  private readonly keyDialog = inject(ApiKeyDialogLauncher);

  protected readonly dashboardActive = isActive('/dashboard', this.router, {
    paths: 'subset',
    queryParams: 'ignored',
  });
  protected readonly aboutActive = isActive('/about', this.router, {
    paths: 'exact',
    queryParams: 'ignored',
  });

  protected openKeyDialog(): void {
    void this.keyDialog.open();
  }
}
