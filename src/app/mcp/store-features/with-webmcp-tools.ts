import {
  ErrorHandler,
  Injector,
  declareExperimentalWebMcpTool,
  inject,
  type WebMcpToolDescriptor,
} from '@angular/core';
import { signalStoreFeature, withHooks } from '@ngrx/signals';

/** Registers WebMCP tools when the store initialises and unregisters them when its injector is destroyed. */
export function withWebMcpTools(tools: () => readonly WebMcpToolDescriptor[]) {
  return signalStoreFeature(
    withHooks(() => {
      const injector = inject(Injector);
      const errors = inject(ErrorHandler);
      return {
        onInit: () => {
          for (const tool of tools()) {
            declareExperimentalWebMcpTool(tool, injector).catch((error: unknown) =>
              errors.handleError(error),
            );
          }
        },
      };
    }),
  );
}
