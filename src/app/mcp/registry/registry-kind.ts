import { InjectionToken } from '@angular/core';
import type { RegistryKind } from './model-context';

export const REGISTRY_KIND = new InjectionToken<RegistryKind>('REGISTRY_KIND', {
  factory: () => 'shim',
});
