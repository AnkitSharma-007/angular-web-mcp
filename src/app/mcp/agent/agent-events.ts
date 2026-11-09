import type { TokenUsage } from '../telemetry/wire-packet';

export type AgentErrorKind =
  'auth' | 'quota' | 'model-access' | 'network' | 'max-steps' | 'unknown';

export type AgentEvent =
  | { type: 'thought' | 'text-delta'; text: string }
  | { type: 'tool-call'; callId: string; name: string; args: unknown }
  | {
      type: 'tool-result';
      callId: string;
      name: string;
      result: unknown;
      ok: boolean;
      latencyMs: number;
    }
  | { type: 'tools-changed'; added: string[]; removed: string[] }
  | { type: 'awaiting-approval'; toolName: string }
  | { type: 'error'; message: string; kind: AgentErrorKind }
  | { type: 'done'; usage: TokenUsage; costUsd: number; model: string; ms: number };

export type AgentEventType = AgentEvent['type'];
