import { Component, inject } from '@angular/core';
import { MatIconButton } from '@angular/material/button';
import { MatIcon } from '@angular/material/icon';
import { MatToolbar } from '@angular/material/toolbar';
import { isActive, Router, RouterLink, RouterOutlet } from '@angular/router';
import { ThemeService } from './core/services/theme';
import { PresenterActions } from './features/agent-console/presenter-actions';
import { LayoutStore } from './features/layout/layout-store';
import { ApiKeyDialogLauncher } from './features/settings/api-key-dialog-launcher';
import { SettingsStore } from './features/settings/settings-store';
import { WireInspector } from './features/wire-inspector/wire-inspector';
import { REGISTRY_KIND } from './mcp/registry/registry-kind';

@Component({
  selector: 'app-root',
  imports: [RouterOutlet, RouterLink, MatToolbar, MatIconButton, MatIcon, WireInspector],
  templateUrl: './app.html',
  host: { '(window:keydown)': 'onKeydown($event)' },
})
export class App {
  protected readonly title = 'Angular Web MCP';
  protected readonly theme = inject(ThemeService);
  protected readonly registryKind = inject(REGISTRY_KIND);
  protected readonly settings = inject(SettingsStore);
  protected readonly layout = inject(LayoutStore);
  private readonly router = inject(Router);
  private readonly keyDialog = inject(ApiKeyDialogLauncher);
  private readonly presenter = inject(PresenterActions);

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

  protected onKeydown(event: KeyboardEvent): void {
    this.presenter.handleKey(event);
  }
}
