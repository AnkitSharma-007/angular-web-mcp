import type { ApplicationConfig } from '@angular/core';
import { provideBrowserGlobalErrorListeners } from '@angular/core';
import {
  provideRouter,
  withAutoCleanupInjectors,
  withComponentInputBinding,
} from '@angular/router';
import { routes } from './app.routes';

export const appConfig: ApplicationConfig = {
  providers: [
    provideBrowserGlobalErrorListeners(),
    provideRouter(routes, withAutoCleanupInjectors(), withComponentInputBinding()),
  ],
};
