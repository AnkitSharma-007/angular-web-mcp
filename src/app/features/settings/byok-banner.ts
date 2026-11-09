import { Component, inject } from '@angular/core';
import { MatButton } from '@angular/material/button';
import { MatIcon } from '@angular/material/icon';
import { ApiKeyDialogLauncher } from './api-key-dialog-launcher';
import { SettingsStore } from './settings-store';

@Component({
  selector: 'app-byok-banner',
  imports: [MatButton, MatIcon],
  templateUrl: './byok-banner.html',
  host: { class: 'block' },
})
export class ByokBanner {
  protected readonly settings = inject(SettingsStore);
  private readonly launcher = inject(ApiKeyDialogLauncher);

  protected openDialog(): void {
    void this.launcher.open();
  }
}
