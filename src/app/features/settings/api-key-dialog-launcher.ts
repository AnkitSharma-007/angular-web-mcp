import { Injector, Service, inject } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import type { ApiKeyDialog } from './api-key-dialog';

@Service()
export class ApiKeyDialogLauncher {
  private readonly injector = inject(Injector);

  async open(): Promise<boolean> {
    const [{ MatDialog }, { ApiKeyDialog: dialog }] = await Promise.all([
      import('@angular/material/dialog'),
      import('./api-key-dialog'),
    ]);
    const ref = this.injector.get(MatDialog).open<ApiKeyDialog, undefined, boolean>(dialog, {
      width: '36rem',
      maxWidth: '95vw',
      autoFocus: 'first-tabbable',
    });
    return (await firstValueFrom(ref.afterClosed())) === true;
  }
}
