import { InjectionToken, type Signal } from '@angular/core';

export interface AgentConfig {
  readonly apiKey: Signal<string>;
  readonly model: Signal<string>;
}

export const AGENT_CONFIG = new InjectionToken<AgentConfig>('AGENT_CONFIG');
