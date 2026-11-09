import { Component, DestroyRef, inject } from '@angular/core';
import { MatButton } from '@angular/material/button';
import { MatIcon } from '@angular/material/icon';
import { PresenterActions } from '../agent-console/presenter-actions';
import { ApiKeyDialogLauncher } from '../settings/api-key-dialog-launcher';
import { SettingsStore } from '../settings/settings-store';
import { EvalPanel } from './eval-panel';
import { EvalSessionStore } from './eval-session';
import { IsolatedRunner } from './isolated-run';
import { ModelRaceStore } from './model-race';
import { RacePanel } from './race-panel';

@Component({
  selector: 'app-lab-page',
  imports: [EvalPanel, MatButton, MatIcon, RacePanel],
  templateUrl: './lab-page.html',
  providers: [ModelRaceStore, EvalSessionStore],
  host: { class: 'flex flex-col gap-4' },
})
export class LabPage {
  protected readonly runner = inject(IsolatedRunner);
  protected readonly settings = inject(SettingsStore);
  private readonly launcher = inject(ApiKeyDialogLauncher);

  constructor() {
    const race = inject(ModelRaceStore);
    const evals = inject(EvalSessionStore);
    const stopAll = () => {
      race.stop();
      evals.stop();
    };
    const unregister = inject(PresenterActions).registerReset(stopAll);
    inject(DestroyRef).onDestroy(() => {
      unregister();
      stopAll();
    });
  }

  protected openKeyDialog(): void {
    void this.launcher.open();
  }
}
