import { bootstrapApplication } from '@angular/platform-browser';
import { mergeApplicationConfig } from '@angular/core';
import { App } from './app/app';
import { appConfig } from './app/app.config';
import { ensureModelContext } from './app/mcp/registry/ensure-model-context';
import { REGISTRY_KIND } from './app/mcp/registry/registry-kind';

ensureModelContext()
  .then((kind) =>
    bootstrapApplication(
      App,
      mergeApplicationConfig(appConfig, {
        providers: [{ provide: REGISTRY_KIND, useValue: kind }],
      }),
    ),
  )
  .catch((err: unknown) => console.error(err));
