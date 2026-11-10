import { Component, DestroyRef, inject } from '@angular/core';
import { MatButton } from '@angular/material/button';
import { MatIcon } from '@angular/material/icon';
import { PresenterActions } from '../agent-console/presenter-actions';
import { ApiKeyDialogLauncher } from '../settings/api-key-dialog-launcher';
import { SettingsStore } from '../settings/settings-store';
import { EvalPanel } from './eval-panel';
import { EvalSessionStore } from './eval-session';
import { IsolatedRunner } from './isolated-run';

@Component({
  selector: 'app-lab-page',
  imports: [EvalPanel, MatButton, MatIcon],
  templateUrl: './lab-page.html',
  providers: [EvalSessionStore],
  host: { class: 'flex flex-col gap-4' },
})
export class LabPage {
  protected readonly runner = inject(IsolatedRunner);
  protected readonly settings = inject(SettingsStore);
  private readonly launcher = inject(ApiKeyDialogLauncher);

  constructor() {
    const evals = inject(EvalSessionStore);
    const stop = () => evals.stop();
    const unregister = inject(PresenterActions).registerReset(stop);
    inject(DestroyRef).onDestroy(() => {
      unregister();
      stop();
    });
  }

  protected openKeyDialog(): void {
    void this.launcher.open();
  }
}
