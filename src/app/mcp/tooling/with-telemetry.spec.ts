import { EnvironmentInjector, runInInjectionContext } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { CLOCK } from '../../core/util/clock';
import { WireTelemetryStore } from '../telemetry/wire-telemetry-store';
import { defineTool } from './define-tool';
import { TOOL_TELEMETRY, createStoreTelemetry } from './with-telemetry';

let now = 5_000;

function setup() {
  now = 5_000;
  TestBed.configureTestingModule({
    providers: [{ provide: CLOCK, useValue: () => new Date(now) }],
  });
  return TestBed.inject(WireTelemetryStore);
}

function run(tool: ReturnType<typeof defineTool>, args: unknown) {
  const execute = tool.execute as (args: unknown) => Promise<unknown>;
  return runInInjectionContext(TestBed.inject(EnvironmentInjector), () => execute(args));
}

describe('createStoreTelemetry', () => {
  it('records an ok span as a tools/call packet with arguments and result', () => {
    const store = setup();
    const span = TestBed.inject(TOOL_TELEMETRY).begin('searchDeals', { limit: 2 });
    expect(store.entities()[0]).toMatchObject({ status: 'pending', channel: 'mcp' });

    span.end('ok', { latencyMs: 12, result: { total: 2 } });
    expect(store.entities()[0]).toMatchObject({
      status: 'ok',
      latencyMs: 12,
      envelope: {
        request: { method: 'tools/call', params: { name: 'searchDeals', arguments: { limit: 2 } } },
        response: { result: { total: 2 } },
      },
    });
  });

  it('defaults missing arguments to an empty object and records errors', () => {
    const store = setup();
    const span = createStoreTelemetry(store).begin('getPipelineSummary', undefined);
    span.end('error', { latencyMs: 1, error: 'nope' });
    expect(store.entities()[0]).toMatchObject({
      status: 'error',
      envelope: {
        request: { params: { arguments: {} } },
        response: { error: { message: 'nope' } },
      },
    });
  });
});

describe('defineTool with the real telemetry store', () => {
  it('records a successful call with its latency', async () => {
    const store = setup();
    const tool = defineTool<{ n: number }>({
      name: 'echo',
      description: 'echo',
      inputSchema: { type: 'object', properties: { n: { type: 'number' } } },
      run: ({ n }) => {
        now += 25;
        return { n };
      },
    });
    await run(tool, { n: 3 });
    expect(store.entities()).toHaveLength(1);
    expect(store.entities()[0]).toMatchObject({
      status: 'ok',
      latencyMs: 25,
      envelope: { response: { result: { n: 3 } } },
    });
  });

  it('records the error and returns it as an error result', async () => {
    const store = setup();
    const tool = defineTool({
      name: 'boom',
      description: 'boom',
      inputSchema: { type: 'object', properties: {} },
      run: () => {
        throw new Error('exploded');
      },
    });
    expect(await run(tool, {})).toMatchObject({ isError: true });
    expect(store.entities()[0]).toMatchObject({
      status: 'error',
      envelope: { response: { error: { message: 'exploded' } } },
    });
  });

  it('records invalid input as an error and a missing gate as a rejection', async () => {
    const store = setup();
    const strict = defineTool({
      name: 'strict',
      description: 'strict',
      inputSchema: { type: 'object', additionalProperties: false, properties: {} },
      run: () => null,
    });
    expect(await run(strict, { extra: 1 })).toMatchObject({ isError: true });

    const risky = defineTool({
      name: 'risky',
      description: 'risky',
      inputSchema: { type: 'object', properties: {} },
      risk: () => ({ toolName: 'risky', risk: 'high', summary: 'x' }),
      run: () => null,
    });
    await run(risky, {});
    expect(store.entities().map((packet) => packet.status)).toEqual(['error', 'rejected']);
    expect(store.entities()[1]?.envelope.response?.result).toMatchObject({
      status: 'rejected_by_human',
    });
  });
});
