import { bootstrapApplication } from '@angular/platform-browser';
import { App } from './app/app';
import { appConfig } from './app/app.config';
import { findModelContext } from './app/mcp/registry/model-context';

const supported = findModelContext() !== null;

(supported
  ? bootstrapApplication(App, appConfig)
  : import('./app/features/unsupported/unsupported-browser').then(({ UnsupportedBrowser }) =>
      bootstrapApplication(UnsupportedBrowser),
    )
).catch((err: unknown) => console.error(err));
