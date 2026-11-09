import { InjectionToken, computed, inject } from '@angular/core';
import { patchState, signalStore, withComputed, withMethods, withState } from '@ngrx/signals';
import {
  addEntity,
  removeAllEntities,
  removeEntities,
  updateEntity,
  withEntities,
} from '@ngrx/signals/entities';
import { CLOCK } from '../../core/util/clock';
import {
  byteLength,
  redactSecrets,
  type JsonRpcResponse,
  type TokenUsage,
  type WireChannel,
  type WireEnvelope,
  type WireMethod,
  type WirePacket,
  type WireStatus,
} from './wire-packet';

export const MAX_PACKETS = 500;
export const INTERNAL_ERROR_CODE = -32603;

export const WIRE_SECRETS = new InjectionToken<() => readonly string[]>('WIRE_SECRETS', {
  providedIn: 'root',
  factory: () => () => [],
});

export interface PacketStart {
  channel: WireChannel;
  method: WireMethod;
  params?: unknown;
  correlationId?: string;
  runId?: string;
  model?: string;
}

export interface PacketOutcome {
  status: Exclude<WireStatus, 'pending'>;
  result?: unknown;
  error?: string;
  latencyMs?: number;
  model?: string;
  tokens?: TokenUsage;
  costUsd?: number;
}

export interface WireStats {
  total: number;
  pending: number;
  calls: number;
  errors: number;
  rejected: number;
  errorRate: number;
  p50: number;
  p95: number;
  totalBytes: number;
}

export interface ModelStats {
  model: string;
  calls: number;
  tokens: TokenUsage;
  costUsd: number;
  avgLatencyMs: number;
}

interface TelemetryState {
  paused: boolean;
}

const NOTIFICATION_PREFIX = 'notifications/';

export function percentile(sorted: readonly number[], p: number): number {
  if (sorted.length === 0) {
    return 0;
  }
  const rank = Math.max(1, Math.ceil((p / 100) * sorted.length));
  return sorted[Math.min(rank, sorted.length) - 1] ?? 0;
}

function isToolCall(packet: WirePacket): boolean {
  return packet.channel === 'mcp' && packet.method === 'tools/call';
}

export function computeWireStats(packets: readonly WirePacket[]): WireStats {
  const calls = packets.filter(isToolCall);
  const settled = calls.filter((packet) => packet.status !== 'pending');
  const errors = settled.filter((packet) => packet.status === 'error').length;
  const latencies = settled
    .flatMap((packet) => (packet.latencyMs === undefined ? [] : [packet.latencyMs]))
    .sort((a, b) => a - b);
  return {
    total: packets.length,
    pending: packets.filter((packet) => packet.status === 'pending').length,
    calls: calls.length,
    errors,
    rejected: settled.filter((packet) => packet.status === 'rejected').length,
    errorRate: settled.length === 0 ? 0 : errors / settled.length,
    p50: percentile(latencies, 50),
    p95: percentile(latencies, 95),
    totalBytes: packets.reduce((sum, packet) => sum + packet.bytes, 0),
  };
}

export function computeModelStats(packets: readonly WirePacket[]): ModelStats[] {
  const groups = new Map<string, WirePacket[]>();
  for (const packet of packets) {
    if (packet.channel === 'llm' && packet.model && packet.status !== 'pending') {
      groups.set(packet.model, [...(groups.get(packet.model) ?? []), packet]);
    }
  }
  return [...groups]
    .map(([model, group]) => ({
      model,
      calls: group.length,
      tokens: group.reduce<TokenUsage>(
        (sum, { tokens }) => ({
          input: sum.input + (tokens?.input ?? 0),
          output: sum.output + (tokens?.output ?? 0),
          thinking: sum.thinking + (tokens?.thinking ?? 0),
        }),
        { input: 0, output: 0, thinking: 0 },
      ),
      costUsd: group.reduce((sum, packet) => sum + (packet.costUsd ?? 0), 0),
      avgLatencyMs: group.reduce((sum, packet) => sum + (packet.latencyMs ?? 0), 0) / group.length,
    }))
    .sort((a, b) => a.model.localeCompare(b.model));
}

export const WireTelemetryStore = signalStore(
  { providedIn: 'root' },
  withEntities<WirePacket>(),
  withState<TelemetryState>({ paused: false }),
  withComputed(({ entities }) => ({
    stats: computed<WireStats>(() => computeWireStats(entities())),
    byModel: computed<ModelStats[]>(() => computeModelStats(entities())),
  })),
  withMethods((store) => {
    const clock = inject(CLOCK);
    const secrets = inject(WIRE_SECRETS);
    let sequence = 0;
    let activeRunId: string | null = null;

    const redact = <T>(value: T): T => redactSecrets(value, secrets());

    const trim = () => {
      const excess = store.entities().length - MAX_PACKETS;
      if (excess > 0) {
        patchState(
          store,
          removeEntities(
            store
              .entities()
              .slice(0, excess)
              .map(({ id }) => id),
          ),
        );
      }
    };

    const respond = (id: number, outcome: PacketOutcome): JsonRpcResponse =>
      outcome.status === 'error'
        ? {
            jsonrpc: '2.0',
            id,
            error: { code: INTERNAL_ERROR_CODE, message: outcome.error ?? 'Unknown error' },
          }
        : { jsonrpc: '2.0', id, result: outcome.result ?? null };

    const begin = (start: PacketStart): number => {
      if (store.paused()) {
        return 0;
      }
      const id = ++sequence;
      const runId = start.runId ?? activeRunId;
      const request: WireEnvelope['request'] = {
        jsonrpc: '2.0',
        ...(!start.method.startsWith(NOTIFICATION_PREFIX) && { id }),
        method: start.method,
        ...(start.params !== undefined && { params: redact(start.params) }),
      };
      const envelope: WireEnvelope = { request };
      patchState(
        store,
        addEntity<WirePacket>({
          id,
          at: clock().getTime(),
          correlationId: start.correlationId ?? `c-${id}`,
          ...(runId !== null && { runId }),
          channel: start.channel,
          method: start.method,
          envelope,
          status: 'pending',
          bytes: byteLength(envelope),
          ...(start.model !== undefined && { model: start.model }),
        }),
      );
      trim();
      return id;
    };

    const end = (id: number, outcome: PacketOutcome): void => {
      const packet = store.entityMap()[id];
      if (!packet || packet.status !== 'pending') {
        return;
      }
      const envelope: WireEnvelope = {
        request: packet.envelope.request,
        response: redact(respond(id, outcome)),
      };
      patchState(
        store,
        updateEntity<WirePacket>({
          id,
          changes: {
            envelope,
            status: outcome.status,
            latencyMs: outcome.latencyMs ?? clock().getTime() - packet.at,
            bytes: byteLength(envelope),
            ...(outcome.model !== undefined && { model: outcome.model }),
            ...(outcome.tokens !== undefined && { tokens: outcome.tokens }),
            ...(outcome.costUsd !== undefined && { costUsd: outcome.costUsd }),
          },
        }),
      );
    };

    return {
      begin,
      end,
      record(start: PacketStart, outcome: PacketOutcome): number {
        const id = begin(start);
        end(id, outcome);
        return id;
      },
      setActiveRun(runId: string | null): void {
        activeRunId = runId;
      },
      pause(): void {
        patchState(store, { paused: true });
      },
      resume(): void {
        patchState(store, { paused: false });
      },
      clear(): void {
        patchState(store, removeAllEntities());
      },
      exportJson(runId: string | null = null): string {
        if (runId === null) {
          return JSON.stringify(redact(store.entities()), null, 2);
        }
        const packets = store.entities().filter((packet) => packet.runId === runId);
        return JSON.stringify(redact({ runId, packets }), null, 2);
      },
    };
  }),
);
