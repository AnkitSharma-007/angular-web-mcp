import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import type { ApprovalRequest } from '../tooling/approval-gate';
import { HUMAN_APPROVAL_GATE } from '../tooling/approval-gate';
import type { AgentEvent } from './agent-events';
import { AgentSessionStore } from './agent-session-store';
import { GeminiAgent, type AgentRunOptions } from './gemini/gemini-agent';

const USAGE = { input: 10, output: 5, thinking: 2 };
const DONE: AgentEvent = { type: 'done', usage: USAGE, costUsd: 0.01, model: 'm', ms: 30 };

type Script = (prompt: string, options: AgentRunOptions) => AsyncGenerator<AgentEvent>;

function events(...list: AgentEvent[]): Script {
  return async function* () {
    yield* list;
  };
}

const untilAborted: Script = async function* (_, { signal }) {
  yield { type: 'text-delta', text: 'working' };
  if (!signal.aborted) {
    await new Promise<void>((resolve) => signal.addEventListener('abort', () => resolve()));
  }
};

function setup(script: Script, withGate = true) {
  const pending = signal<ApprovalRequest | null>(null);
  const created = vi.fn();
  const calls: { prompt: string; options: AgentRunOptions }[] = [];
  TestBed.configureTestingModule({
    providers: [
      {
        provide: GeminiAgent,
        useFactory: () => {
          created();
          return {
            run: (prompt: string, options: AgentRunOptions) => {
              calls.push({ prompt, options });
              return script(prompt, options);
            },
          };
        },
      },
      ...(withGate
        ? [{ provide: HUMAN_APPROVAL_GATE, useValue: { pending, request: vi.fn() } }]
        : []),
    ],
  });
  return { store: TestBed.inject(AgentSessionStore), pending, created, calls };
}

const kinds = (store: InstanceType<typeof AgentSessionStore>) =>
  store.transcript().map((entry) => (entry.kind === 'user' ? 'user' : entry.event.type));

describe('AgentSessionStore', () => {
  it('starts idle and empty', () => {
    const { store, created } = setup(events());
    expect(store.status()).toBe('idle');
    expect(store.transcript()).toEqual([]);
    expect(store.lastUsage()).toBeNull();
    expect(created).not.toHaveBeenCalled();
  });

  it('loads the agent lazily and only once', async () => {
    const { store, created } = setup(events(DONE));
    await store.run('first');
    await store.run('second');
    expect(created).toHaveBeenCalledOnce();
  });

  it('records the prompt and the events, and returns to idle', async () => {
    const { store } = setup(
      events(
        { type: 'tool-call', callId: 'c', name: 'x', args: {} },
        { type: 'tool-result', callId: 'c', name: 'x', result: 1, ok: true, latencyMs: 2 },
        { type: 'text-delta', text: 'Hi' },
        DONE,
      ),
    );
    await store.run('  Hello  ');
    expect(kinds(store)).toEqual(['user', 'tool-call', 'tool-result', 'text-delta', 'done']);
    expect(store.transcript()[0]).toMatchObject({ kind: 'user', text: 'Hello' });
    expect(store.status()).toBe('idle');
    expect(store.running()).toBe(false);
  });

  it('merges consecutive text deltas and thoughts into one entry each', async () => {
    const { store } = setup(
      events(
        { type: 'thought', text: 'a' },
        { type: 'thought', text: 'b' },
        { type: 'text-delta', text: 'Hel' },
        { type: 'text-delta', text: 'lo' },
        { type: 'tool-call', callId: 'c', name: 'x', args: {} },
        { type: 'text-delta', text: 'again' },
      ),
    );
    await store.run('go');
    const texts = store
      .transcript()
      .flatMap((entry) =>
        entry.kind === 'event' && 'text' in entry.event
          ? [`${entry.event.type}:${entry.event.text}`]
          : [],
      );
    expect(texts).toEqual(['thought:ab', 'text-delta:Hello', 'text-delta:again']);
  });

  it('keeps the usage, cost and model of the last run', async () => {
    const { store } = setup(events(DONE));
    await store.run('go');
    expect(store.lastUsage()).toEqual(USAGE);
    expect(store.lastCostUsd()).toBe(0.01);
    expect(store.lastModel()).toBe('m');
  });

  it('passes the model and run id to the agent', async () => {
    const { store, calls } = setup(events(DONE));
    await store.run('go', { model: 'gemini-4-argon', runId: 'r1' });
    expect(calls[0]?.options).toMatchObject({ model: 'gemini-4-argon', runId: 'r1' });
    await store.run('again');
    expect(calls[1]?.options).not.toHaveProperty('model');
  });

  it('ignores a blank prompt', async () => {
    const { store, calls } = setup(events(DONE));
    await store.run('   ');
    expect(calls).toHaveLength(0);
    expect(store.transcript()).toEqual([]);
  });

  it('ignores a run while another one is running', async () => {
    const { store, calls } = setup(untilAborted);
    const first = store.run('first');
    await vi.waitFor(() => expect(calls).toHaveLength(1));
    await store.run('second');
    expect(calls).toHaveLength(1);
    store.stop();
    await first;
  });

  it('stops a run by aborting its signal', async () => {
    const { store, calls } = setup(untilAborted);
    const done = store.run('go');
    await vi.waitFor(() => expect(store.status()).toBe('running'));
    store.stop();
    await done;
    expect(calls[0]?.options.signal.aborted).toBe(true);
    expect(store.status()).toBe('idle');
  });

  it('lets a new run start right after a clear without the old run touching it', async () => {
    const { store, calls } = setup(untilAborted);
    const first = store.run('first');
    await vi.waitFor(() => expect(calls).toHaveLength(1));
    store.clear();
    const second = store.run('second');
    await first;
    expect(store.status()).toBe('running');
    store.stop();
    await second;
    expect(calls).toHaveLength(2);
    expect(store.status()).toBe('idle');
  });

  it('does nothing when stopped while idle', () => {
    const { store } = setup(events());
    expect(() => store.stop()).not.toThrow();
    expect(store.status()).toBe('idle');
  });

  it('shows an error status after an error event and clears it on the next run', async () => {
    const { store } = setup((prompt) =>
      prompt === 'bad'
        ? events({ type: 'error', kind: 'auth', message: 'no' })(prompt, undefined as never)
        : events(DONE)(prompt, undefined as never),
    );
    await store.run('bad');
    expect(store.status()).toBe('error');
    await store.run('good');
    expect(store.status()).toBe('idle');
  });

  it('turns a thrown agent failure into an error entry', async () => {
    const { store } = setup(async function* () {
      yield { type: 'text-delta', text: 'x' } satisfies AgentEvent;
      throw new Error('stream broke');
    });
    await store.run('go');
    expect(store.status()).toBe('error');
    expect(store.transcript().at(-1)).toMatchObject({
      event: { type: 'error', kind: 'unknown', message: 'stream broke' },
    });
  });

  it('stringifies a thrown non-error', async () => {
    const { store } = setup(async function* () {
      throw 'plain';
    });
    await store.run('go');
    expect(store.transcript().at(-1)).toMatchObject({ event: { message: 'plain' } });
  });

  it('clears the transcript and aborts a run in progress', async () => {
    const { store, calls } = setup(untilAborted);
    const done = store.run('go');
    await vi.waitFor(() => expect(store.status()).toBe('running'));
    store.clear();
    await done;
    expect(calls[0]?.options.signal.aborted).toBe(true);
    expect(store.transcript()).toEqual([]);
    expect(store.status()).toBe('idle');
  });

  describe('awaiting approval', () => {
    const request: ApprovalRequest = {
      toolName: 'terminateContract',
      risk: 'critical',
      summary: 's',
    };

    it('derives awaiting-approval from the gate while running', async () => {
      const { store, pending } = setup(untilAborted);
      const done = store.run('go');
      await vi.waitFor(() => expect(store.status()).toBe('running'));

      pending.set(request);
      expect(store.status()).toBe('awaiting-approval');
      TestBed.tick();
      expect(store.transcript().at(-1)).toMatchObject({
        event: { type: 'awaiting-approval', toolName: 'terminateContract' },
      });

      pending.set(null);
      expect(store.status()).toBe('running');
      store.stop();
      await done;
    });

    it('stays idle and records nothing when nothing is running', () => {
      const { store, pending } = setup(events());
      pending.set(request);
      TestBed.tick();
      expect(store.status()).toBe('idle');
      expect(store.transcript()).toEqual([]);
    });

    it('works without a gate', async () => {
      const { store } = setup(untilAborted, false);
      const done = store.run('go');
      await vi.waitFor(() => expect(store.status()).toBe('running'));
      TestBed.tick();
      expect(store.status()).toBe('running');
      store.stop();
      await done;
    });
  });
});
