import type { Provider } from '@angular/core';
import { REGISTRY_KIND } from '../app/mcp/registry/registry-kind';
import type { RegistryKind } from '../app/mcp/registry/model-context';
import {
  installFakeModelContext,
  uninstallFakeModelContext,
  type FakeModelContext,
} from './fake-model-context';

export function provideRegistryKind(kind: RegistryKind): Provider {
  return { provide: REGISTRY_KIND, useValue: kind };
}

export function useFakeModelContext(): { readonly current: FakeModelContext } {
  let fake: FakeModelContext | undefined;
  beforeEach(() => {
    fake = installFakeModelContext();
  });
  afterEach(() => {
    fake?.reset();
    uninstallFakeModelContext();
  });
  return {
    get current() {
      if (!fake) throw new Error('useFakeModelContext(): accessed outside a test');
      return fake;
    },
  };
}
