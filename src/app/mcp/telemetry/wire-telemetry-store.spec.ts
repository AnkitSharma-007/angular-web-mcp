import { TestBed } from '@angular/core/testing';
import { CLOCK } from '../../core/util/clock';
import { REDACTED } from './wire-packet';
import {
  MAX_PACKETS,
  WIRE_SECRETS,
  WireTelemetryStore,
  percentile,
  type PacketStart,
} from './wire-telemetry-store';

const KEY = 'AIzaSyFAKEKEY1234567890';
const CALL: PacketStart = {
  channel: 'mcp',
  method: 'tools/call',
  params: { name: 'searchDeals', arguments: {} },
};

let now = 1_000;

function setup(secrets: string[] = []) {
  now = 1_000;
  TestBed.configureTestingModule({
    providers: [
      { provide: CLOCK, useValue: () => new Date(now) },
      { provide: WIRE_SECRETS, useValue: () => secrets },
    ],
  });
  return TestBed.inject(WireTelemetryStore);
}

function call(store: ReturnType<typeof setup>, latencyMs: number, status: 'ok' | 'error' = 'ok') {
  store.end(store.begin(CALL), { status, latencyMs, error: status === 'error' ? 'bad' : '' });
}

describe('percentile', () => {
  it('uses nearest-rank and handles empty input', () => {
    expect(percentile([], 50)).toBe(0);
    expect(percentile([10, 20, 30, 40], 50)).toBe(20);
    expect(percentile([10, 20, 30, 40], 95)).toBe(40);
    expect(percentile([7], 95)).toBe(7);
  });
});

describe('WireTelemetryStore', () => {
  describe('active run', () => {
    it('tags every packet opened while a run is active', () => {
      const store = setup();
      store.setActiveRun('run-7');
      const first = store.begin(CALL);
      const second = store.record({ channel: 'hitl', method: 'hitl/requested' }, { status: 'ok' });
      expect(store.entityMap()[first]?.runId).toBe('run-7');
      expect(store.entityMap()[second]?.runId).toBe('run-7');
    });

    it('stops tagging once the run is cleared', () => {
      const store = setup();
      store.setActiveRun('run-7');
      store.setActiveRun(null);
      const id = store.begin(CALL);
      expect(store.entityMap()[id]?.runId).toBeUndefined();
    });

    it('lets an explicit run id win over the active one', () => {
      const store = setup();
      store.setActiveRun('run-7');
      const id = store.begin({ ...CALL, runId: 'other' });
      expect(store.entityMap()[id]?.runId).toBe('other');
    });
  });

  describe('begin/end', () => {
    it('opens a pending json-rpc request and closes it with a response and latency', () => {
      const store = setup();
      const id = store.begin({ ...CALL, correlationId: 'run-1', runId: 'r1' });
      expect(store.entityMap()[id]).toMatchObject({
        at: 1_000,
        status: 'pending',
        correlationId: 'run-1',
        runId: 'r1',
        channel: 'mcp',
        method: 'tools/call',
        envelope: { request: { jsonrpc: '2.0', id, method: 'tools/call' } },
      });

      now = 1_042;
      store.end(id, { status: 'ok', result: { total: 3 } });
      expect(store.entityMap()[id]).toMatchObject({
        status: 'ok',
        latencyMs: 42,
        envelope: { response: { jsonrpc: '2.0', id, result: { total: 3 } } },
      });
      expect(store.entityMap()[id]?.bytes).toBeGreaterThan(50);
    });

    it('prefers an explicit latency and records errors as json-rpc error objects', () => {
      const store = setup();
      const id = store.begin(CALL);
      store.end(id, { status: 'error', error: 'boom', latencyMs: 9 });
      expect(store.entityMap()[id]).toMatchObject({
        status: 'error',
        latencyMs: 9,
        envelope: { response: { error: { code: -32603, message: 'boom' } } },
      });
    });

    it('defaults the error message and a null result', () => {
      const store = setup();
      const failed = store.begin(CALL);
      store.end(failed, { status: 'error' });
      const empty = store.begin(CALL);
      store.end(empty, { status: 'ok' });
      expect(store.entityMap()[failed]?.envelope.response?.error?.message).toBe('Unknown error');
      expect(store.entityMap()[empty]?.envelope.response?.result).toBeNull();
    });

    it('ignores end for unknown or already settled packets', () => {
      const store = setup();
      store.end(99, { status: 'ok' });
      const id = store.begin(CALL);
      store.end(id, { status: 'ok', latencyMs: 1 });
      store.end(id, { status: 'error', latencyMs: 500 });
      expect(store.entityMap()[id]).toMatchObject({ status: 'ok', latencyMs: 1 });
      expect(store.entities()).toHaveLength(1);
    });

    it('frames notifications without a request id', () => {
      const store = setup();
      const id = store.record(
        { channel: 'mcp', method: 'notifications/tools/list_changed' },
        { status: 'ok' },
      );
      const request = store.entityMap()[id]?.envelope.request;
      expect(request).toEqual({ jsonrpc: '2.0', method: 'notifications/tools/list_changed' });
    });

    it('stores model, tokens and cost from the outcome', () => {
      const store = setup();
      const id = store.record(
        { channel: 'llm', method: 'generateContent', model: 'm1' },
        {
          status: 'ok',
          model: 'm2',
          tokens: { input: 1, output: 2, thinking: 3 },
          costUsd: 0.5,
        },
      );
      expect(store.entityMap()[id]).toMatchObject({
        model: 'm2',
        tokens: { input: 1, output: 2, thinking: 3 },
        costUsd: 0.5,
      });
    });
  });

  describe('cap', () => {
    it('keeps only the newest 500 packets', () => {
      const store = setup();
      for (let i = 0; i < MAX_PACKETS + 25; i++) {
        store.record(CALL, { status: 'ok', latencyMs: 1 });
      }
      expect(store.entities()).toHaveLength(MAX_PACKETS);
      expect(store.entities()[0]?.id).toBe(26);
      expect(store.entities().at(-1)?.id).toBe(MAX_PACKETS + 25);
    });
  });

  describe('stats', () => {
    it('is empty before any call', () => {
      expect(setup().stats()).toEqual({
        total: 0,
        pending: 0,
        calls: 0,
        errors: 0,
        rejected: 0,
        errorRate: 0,
        p50: 0,
        p95: 0,
        totalBytes: 0,
      });
    });

    it('computes p50, p95 and error rate over settled tool calls only', () => {
      const store = setup();
      [10, 20, 30, 40].forEach((ms) => call(store, ms));
      call(store, 100, 'error');
      store.begin(CALL);
      store.record({ channel: 'hitl', method: 'hitl/resolved' }, { status: 'ok', latencyMs: 9000 });
      store.record(
        { channel: 'llm', method: 'generateContent' },
        { status: 'ok', latencyMs: 8000 },
      );
      store.record(CALL, { status: 'rejected' });

      const stats = store.stats();
      expect(stats).toMatchObject({ calls: 7, pending: 1, errors: 1, rejected: 1 });
      expect(stats.errorRate).toBeCloseTo(1 / 6);
      expect(stats.p50).toBe(20);
      expect(stats.p95).toBe(100);
      expect(stats.totalBytes).toBeGreaterThan(0);
    });
  });

  describe('byModel', () => {
    it('aggregates settled llm packets per model', () => {
      const store = setup();
      const llm = (model: string, input: number, costUsd: number, latencyMs: number) =>
        store.record(
          { channel: 'llm', method: 'generateContent', model },
          { status: 'ok', latencyMs, tokens: { input, output: 10, thinking: 5 }, costUsd },
        );
      llm('gemini-b', 100, 0.01, 200);
      llm('gemini-a', 50, 0.02, 100);
      llm('gemini-b', 300, 0.03, 400);
      store.begin({ channel: 'llm', method: 'generateContent', model: 'gemini-a' });
      store.record({ channel: 'llm', method: 'generateContent' }, { status: 'ok' });
      call(store, 5);

      expect(store.byModel()).toEqual([
        {
          model: 'gemini-a',
          calls: 1,
          tokens: { input: 50, output: 10, thinking: 5 },
          costUsd: 0.02,
          avgLatencyMs: 100,
        },
        {
          model: 'gemini-b',
          calls: 2,
          tokens: { input: 400, output: 20, thinking: 10 },
          costUsd: 0.04,
          avgLatencyMs: 300,
        },
      ]);
    });

    it('tolerates llm packets without usage or cost', () => {
      const store = setup();
      store.record({ channel: 'llm', method: 'generateContent', model: 'm' }, { status: 'error' });
      expect(store.byModel()[0]).toMatchObject({
        calls: 1,
        tokens: { input: 0, output: 0, thinking: 0 },
        costUsd: 0,
      });
    });
  });

  describe('pause and clear', () => {
    it('drops new packets while paused, still settles open ones, and resumes', () => {
      const store = setup();
      const open = store.begin(CALL);
      store.pause();
      expect(store.paused()).toBe(true);
      expect(store.begin(CALL)).toBe(0);
      expect(store.record(CALL, { status: 'ok' })).toBe(0);
      store.end(open, { status: 'ok', latencyMs: 3 });
      expect(store.entities()).toHaveLength(1);
      expect(store.entities()[0]?.status).toBe('ok');

      store.resume();
      expect(store.begin(CALL)).toBe(2);
    });

    it('clears packets without reusing ids', () => {
      const store = setup();
      store.record(CALL, { status: 'ok' });
      store.clear();
      expect(store.entities()).toEqual([]);
      expect(store.begin(CALL)).toBe(2);
    });
  });

  describe('redaction', () => {
    it('masks the header, key= values and the raw key in stored envelopes', () => {
      const store = setup([KEY]);
      const id = store.begin({
        channel: 'llm',
        method: 'generateContent',
        params: {
          url: 'https://generativelanguage.googleapis.com/v1?key=abc123',
          headers: { 'x-goog-api-key': KEY },
          prompt: `my key is ${KEY}`,
        },
      });
      store.end(id, { status: 'error', error: `403 for ${KEY}` });

      const json = JSON.stringify(store.entityMap()[id]);
      expect(json).not.toContain(KEY);
      expect(json).not.toContain('abc123');
      expect(json).toContain(REDACTED);
      expect(store.exportJson()).not.toContain(KEY);
    });
  });

  describe('exportJson', () => {
    it('serialises every packet as pretty json', () => {
      const store = setup();
      store.record(CALL, { status: 'ok', latencyMs: 4 });
      const parsed = JSON.parse(store.exportJson()) as { id: number; status: string }[];
      expect(parsed).toHaveLength(1);
      expect(parsed[0]).toMatchObject({ id: 1, status: 'ok' });
    });
  });
});
