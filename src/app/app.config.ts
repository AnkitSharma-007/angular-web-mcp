import type { ApplicationConfig } from '@angular/core';
import { inject, provideBrowserGlobalErrorListeners } from '@angular/core';
import { provideExperimentalWebMcpForms } from '@angular/forms/signals';
import { MAT_ICON_DEFAULT_OPTIONS } from '@angular/material/icon';
import {
  provideRouter,
  withAutoCleanupInjectors,
  withComponentInputBinding,
} from '@angular/router';
import { routes } from './app.routes';
import { ApprovalService } from './features/approvals/approval-service';
import { SettingsStore } from './features/settings/settings-store';
import { AGENT_CONFIG } from './mcp/agent/agent-config';
import { HUMAN_APPROVAL_GATE } from './mcp/tooling/approval-gate';
import { WIRE_SECRETS } from './mcp/telemetry/wire-telemetry-store';

export const appConfig: ApplicationConfig = {
  providers: [
    provideBrowserGlobalErrorListeners(),
    provideExperimentalWebMcpForms(),
    provideRouter(routes, withAutoCleanupInjectors(), withComponentInputBinding()),
    { provide: MAT_ICON_DEFAULT_OPTIONS, useValue: { fontSet: 'material-symbols-outlined' } },
    { provide: AGENT_CONFIG, useFactory: () => inject(SettingsStore) },
    { provide: HUMAN_APPROVAL_GATE, useExisting: ApprovalService },
    {
      provide: WIRE_SECRETS,
      useFactory: () => {
        const settings = inject(SettingsStore);
        return () => [settings.apiKey()];
      },
    },
  ],
};
