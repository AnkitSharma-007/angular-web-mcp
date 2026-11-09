import { EnvironmentInjector, InjectionToken, inject, runInInjectionContext } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import type { WebMcpToolDescriptor } from '@angular/core';
import { CLOCK } from '../../core/util/clock';
import { HUMAN_APPROVAL_GATE, type HumanApprovalGate } from './approval-gate';
import { defineTool, toToolResult, type ToolDefinition } from './define-tool';
import { TOOL_TELEMETRY } from './with-telemetry';

const SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['dealId'],
  properties: { dealId: { type: 'string', pattern: '^D-\\d{4}$' } },
} as const;

const REQUEST = { toolName: 'probe', risk: 'high', summary: 'Do the thing' } as const;

interface Args {
  dealId: string;
}

const end = vi.fn();
const begin = vi.fn(() => ({ end }));

function invoke(tool: WebMcpToolDescriptor, args: unknown, client?: { signal?: AbortSignal }) {
  const injector = TestBed.inject(EnvironmentInjector);
  const execute = tool.execute as (args: unknown, client?: unknown) => Promise<unknown>;
  return runInInjectionContext(injector, () => execute(args, client));
}

function setup(gate?: Partial<HumanApprovalGate>, now: () => Date = () => new Date(0)) {
  TestBed.configureTestingModule({
    providers: [
      { provide: TOOL_TELEMETRY, useValue: { begin } },
      { provide: CLOCK, useValue: now },
      ...(gate ? [{ provide: HUMAN_APPROVAL_GATE, useValue: gate }] : []),
    ],
  });
}

function tool(overrides: Partial<ToolDefinition<Args>> = {}) {
  return defineTool<Args>({
    name: 'probe',
    description: 'A probe tool',
    inputSchema: SCHEMA,
    run: () => ({ ok: true }),
    ...overrides,
  });
}

function parse(result: unknown): unknown {
  return JSON.parse((result as { content: { text: string }[] }).content[0]?.text ?? 'null');
}

function failure(result: unknown): string {
  const envelope = result as { isError?: boolean; content: { text: string }[] };
  expect(envelope.isError).toBe(true);
  return envelope.content[0]?.text ?? '';
}

describe('defineTool', () => {
  beforeEach(() => {
    end.mockClear();
    begin.mockClear();
  });

  it('exposes the descriptor metadata', () => {
    const descriptor = tool({ title: 'Probe', annotations: { readOnlyHint: true } });
    expect(descriptor).toMatchObject({
      name: 'probe',
      title: 'Probe',
      description: 'A probe tool',
      annotations: { readOnlyHint: true },
      inputSchema: SCHEMA,
    });
    const bare = tool();
    expect('title' in bare).toBe(false);
    expect('annotations' in bare).toBe(false);
  });

  it('wraps the return value in a JSON text envelope', async () => {
    setup();
    const result = await invoke(tool({ run: () => ({ total: 2 }) }), { dealId: 'D-1001' });
    expect(result).toEqual({ content: [{ type: 'text', text: '{"total":2}' }] });
    expect(toToolResult(undefined).content[0]?.text).toBe('null');
  });

  it('returns invalid input as an error result with the field path and never runs the body', async () => {
    setup();
    const run = vi.fn();
    const message = failure(await invoke(tool({ run }), { dealId: 'nope' }));
    expect(message).toContain('Invalid input for probe: dealId');
    expect(run).not.toHaveBeenCalled();
    expect(end).toHaveBeenCalledWith(
      'error',
      expect.objectContaining({ error: expect.any(String) }),
    );
  });

  it('treats missing args as an empty object', async () => {
    setup();
    expect(failure(await invoke(tool(), undefined))).toContain('dealId: is required');
  });

  it('opens a span with the tool name and closes it with latency from CLOCK', async () => {
    let tick = 1000;
    setup(undefined, () => new Date((tick += 50)));
    await invoke(tool(), { dealId: 'D-1001' });
    expect(begin).toHaveBeenCalledWith('probe', { dealId: 'D-1001' });
    expect(end).toHaveBeenCalledWith('ok', { latencyMs: 50, result: { ok: true } });
  });

  it('records failures from the body and returns them as error results', async () => {
    setup();
    const result = await invoke(tool({ run: () => Promise.reject(new Error('boom')) }), {
      dealId: 'D-1001',
    });
    expect(failure(result)).toBe('boom');
    expect(end).toHaveBeenCalledWith('error', expect.objectContaining({ error: 'boom' }));
  });

  it('stringifies non-Error failures', async () => {
    setup();
    const run = () => {
      throw 'plain';
    };
    expect(failure(await invoke(tool({ run }), { dealId: 'D-1001' }))).toBe('plain');
    expect(end).toHaveBeenCalledWith('error', expect.objectContaining({ error: 'plain' }));
  });

  it('passes the client signal through, or a live one when none is given', async () => {
    setup();
    const seen: AbortSignal[] = [];
    const probe = tool({ run: (_args, ctx) => void seen.push(ctx.signal) });
    const controller = new AbortController();
    await invoke(probe, { dealId: 'D-1001' }, { signal: controller.signal });
    await invoke(probe, { dealId: 'D-1001' });
    expect(seen[0]).toBe(controller.signal);
    expect(seen[1]?.aborted).toBe(false);
  });

  it('skips the gate when the risk policy returns no request', async () => {
    const request = vi.fn();
    setup({ request });
    const result = await invoke(tool({ risk: () => null }), { dealId: 'D-1001' });
    expect(parse(result)).toEqual({ ok: true });
    expect(request).not.toHaveBeenCalled();
  });

  describe('human approval', () => {
    it('rejects a risky call when no gate is provided (fail-safe)', async () => {
      setup();
      const run = vi.fn();
      const snapshot = { recordSnapshot: vi.fn() };
      const result = await invoke(tool({ risk: () => REQUEST, run, snapshot }), {
        dealId: 'D-1001',
      });
      expect(parse(result)).toEqual({
        status: 'rejected_by_human',
        note: 'no human approval gate is available',
      });
      expect(run).not.toHaveBeenCalled();
      expect(snapshot.recordSnapshot).not.toHaveBeenCalled();
      expect(end).toHaveBeenCalledWith('rejected', expect.any(Object));
    });

    it('returns a rejection as a result, with the note, without snapshotting', async () => {
      const request = vi.fn().mockResolvedValue({ approved: false, note: 'too aggressive' });
      setup({ request });
      const run = vi.fn();
      const snapshot = { recordSnapshot: vi.fn() };
      const result = await invoke(tool({ risk: () => REQUEST, run, snapshot }), {
        dealId: 'D-1001',
      });
      expect(parse(result)).toEqual({ status: 'rejected_by_human', note: 'too aggressive' });
      expect(run).not.toHaveBeenCalled();
      expect(snapshot.recordSnapshot).not.toHaveBeenCalled();
    });

    it('omits the note when the human gave none', async () => {
      setup({ request: vi.fn().mockResolvedValue({ approved: false }) });
      const result = await invoke(tool({ risk: () => REQUEST }), { dealId: 'D-1001' });
      expect(parse(result)).toEqual({ status: 'rejected_by_human' });
    });

    it('snapshots after approval and before running', async () => {
      const order: string[] = [];
      const request = vi.fn(async () => {
        order.push('approval');
        return { approved: true };
      });
      setup({ request });
      const controller = new AbortController();
      await invoke(
        tool({
          risk: () => REQUEST,
          snapshot: {
            recordSnapshot: () => {
              order.push('snapshot');
              return 'h-1';
            },
          },
          run: () => void order.push('run'),
        }),
        { dealId: 'D-1001' },
        { signal: controller.signal },
      );
      expect(order).toEqual(['approval', 'snapshot', 'run']);
      expect(request).toHaveBeenCalledWith(REQUEST, controller.signal);
    });
  });

  describe('snapshots', () => {
    it('records a labelled snapshot before run and exposes its id to the body', async () => {
      setup();
      const recordSnapshot = vi.fn(() => 'h-7');
      const run = vi.fn((_args: Args, ctx: { snapshotId?: string }) => ctx.snapshotId);
      const result = await invoke(
        tool({
          snapshot: { recordSnapshot },
          snapshotLabel: ({ dealId }) => `change ${dealId}`,
          run,
        }),
        { dealId: 'D-1001' },
      );
      expect(recordSnapshot).toHaveBeenCalledExactlyOnceWith('change D-1001');
      expect(parse(result)).toBe('h-7');
    });

    it('falls back to the title, then the name, as the label', async () => {
      setup();
      const recordSnapshot = vi.fn(() => 'h-1');
      await invoke(tool({ snapshot: { recordSnapshot }, title: 'Probe tool' }), {
        dealId: 'D-1001',
      });
      await invoke(tool({ snapshot: { recordSnapshot } }), { dealId: 'D-1001' });
      expect(recordSnapshot.mock.calls).toEqual([['Probe tool'], ['probe']]);
    });

    it('does not snapshot when validation fails or the tool has no snapshot target', async () => {
      setup();
      const recordSnapshot = vi.fn(() => 'h-1');
      failure(await invoke(tool({ snapshot: { recordSnapshot } }), { dealId: 'nope' }));
      await invoke(tool(), { dealId: 'D-1001' });
      expect(recordSnapshot).not.toHaveBeenCalled();
    });
  });

  describe('D5: dependencies resolved before the first await', () => {
    const DEP = new InjectionToken<string>('DEP');

    it('lets the body use deps and ctx after an async approval', async () => {
      let release!: () => void;
      const request = () =>
        new Promise<{ approved: boolean }>((resolve) => {
          release = () => resolve({ approved: true });
        });
      TestBed.configureTestingModule({
        providers: [
          { provide: TOOL_TELEMETRY, useValue: { begin } },
          { provide: CLOCK, useValue: () => new Date('2026-11-09T00:00:00.000Z') },
          { provide: HUMAN_APPROVAL_GATE, useValue: { request } },
          { provide: DEP, useValue: 'resolved-early' },
        ],
      });
      const pending = invoke(
        defineTool<Args, string>({
          name: 'late',
          description: 'uses deps after await',
          inputSchema: SCHEMA,
          risk: () => REQUEST,
          deps: () => inject(DEP),
          run: (_args, ctx, dep) => `${dep}@${ctx.now().toISOString()}`,
        }),
        { dealId: 'D-1001' },
      );
      await Promise.resolve();
      release();
      expect(parse(await pending)).toBe('resolved-early@2026-11-09T00:00:00.000Z');
    });

    it('fails with NG0203 if the body injects after the await', async () => {
      TestBed.configureTestingModule({
        providers: [
          { provide: TOOL_TELEMETRY, useValue: { begin } },
          { provide: HUMAN_APPROVAL_GATE, useValue: { request: async () => ({ approved: true }) } },
          { provide: DEP, useValue: 'x' },
        ],
      });
      const naive = defineTool<Args>({
        name: 'naive',
        description: 'injects late',
        inputSchema: SCHEMA,
        risk: () => REQUEST,
        run: () => inject(DEP),
      });
      expect(failure(await invoke(naive, { dealId: 'D-1001' }))).toMatch(/NG0203|inject\(\)/);
    });
  });
});
