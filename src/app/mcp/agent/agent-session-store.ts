import { effect, computed, inject, injectAsync, untracked } from '@angular/core';
import {
  patchState,
  signalStore,
  withComputed,
  withHooks,
  withMethods,
  withProps,
  withState,
} from '@ngrx/signals';
import { HUMAN_APPROVAL_GATE } from '../tooling/approval-gate';
import type { TokenUsage } from '../telemetry/wire-packet';
import type { AgentEvent } from './agent-events';

export type SessionPhase = 'idle' | 'running' | 'error';
export type SessionStatus = SessionPhase | 'awaiting-approval';

export type TranscriptEntry =
  { id: number; kind: 'user'; text: string } | { id: number; kind: 'event'; event: AgentEvent };

export interface RunRequest {
  model?: string;
  runId?: string;
}

interface SessionState {
  transcript: TranscriptEntry[];
  phase: SessionPhase;
  lastUsage: TokenUsage | null;
  lastCostUsd: number;
  lastModel: string | null;
}

const INITIAL: SessionState = {
  transcript: [],
  phase: 'idle',
  lastUsage: null,
  lastCostUsd: 0,
  lastModel: null,
};

function appendEvent(
  transcript: TranscriptEntry[],
  event: AgentEvent,
  id: number,
): TranscriptEntry[] {
  const last = transcript.at(-1);
  const streams = event.type === 'thought' || event.type === 'text-delta';
  if (streams && last?.kind === 'event' && last.event.type === event.type) {
    return [
      ...transcript.slice(0, -1),
      {
        id: last.id,
        kind: 'event',
        event: { type: event.type, text: last.event.text + event.text },
      },
    ];
  }
  return [...transcript, { id, kind: 'event', event }];
}

export const AgentSessionStore = signalStore(
  { providedIn: 'root' },
  withState<SessionState>(INITIAL),
  withProps(() => ({
    _loadAgent: injectAsync(() => import('./gemini/gemini-agent').then((m) => m.GeminiAgent)),
    _gate: inject(HUMAN_APPROVAL_GATE, { optional: true }),
    _run: { controller: null as AbortController | null, sequence: 0 },
  })),
  withComputed(({ phase, _gate }) => ({
    status: computed<SessionStatus>(() =>
      phase() === 'running' && _gate?.pending() ? 'awaiting-approval' : phase(),
    ),
    running: computed(() => phase() === 'running'),
  })),
  withMethods((store) => {
    const push = (event: AgentEvent): void => {
      patchState(store, (state) => ({
        transcript: appendEvent(state.transcript, event, ++store._run.sequence),
      }));
    };

    return {
      async run(prompt: string, request: RunRequest = {}): Promise<void> {
        const text = prompt.trim();
        if (store.phase() === 'running' || text === '') {
          return;
        }
        const controller = new AbortController();
        store._run.controller = controller;
        const entry: TranscriptEntry = { id: ++store._run.sequence, kind: 'user', text };
        patchState(store, (state) => ({
          phase: 'running' as const,
          transcript: [...state.transcript, entry],
          lastUsage: null,
          lastCostUsd: 0,
          lastModel: null,
        }));
        let failed = false;
        try {
          const agent = await store._loadAgent();
          const options = {
            signal: controller.signal,
            ...(request.model !== undefined && { model: request.model }),
            ...(request.runId !== undefined && { runId: request.runId }),
          };
          for await (const event of agent.run(text, options)) {
            if (controller.signal.aborted && event.type !== 'done') {
              continue;
            }
            if (event.type === 'error') {
              failed = true;
            }
            if (event.type === 'done') {
              patchState(store, {
                lastUsage: event.usage,
                lastCostUsd: event.costUsd,
                lastModel: event.model,
              });
            }
            push(event);
          }
        } catch (error) {
          failed = true;
          push({
            type: 'error',
            kind: 'unknown',
            message: error instanceof Error ? error.message : String(error),
          });
        } finally {
          if (store._run.controller === controller) {
            store._run.controller = null;
            patchState(store, { phase: failed ? 'error' : 'idle' });
          }
        }
      },
      stop(): void {
        store._run.controller?.abort();
      },
      clear(): void {
        store._run.controller?.abort();
        store._run.controller = null;
        patchState(store, INITIAL);
      },
    };
  }),
  withHooks({
    onInit: (store) => {
      effect(() => {
        const pending = store._gate?.pending() ?? null;
        if (pending !== null && untracked(store.phase) === 'running') {
          untracked(() =>
            patchState(store, (state) => ({
              transcript: appendEvent(
                state.transcript,
                { type: 'awaiting-approval', toolName: pending.toolName },
                ++store._run.sequence,
              ),
            })),
          );
        }
      });
    },
  }),
);
