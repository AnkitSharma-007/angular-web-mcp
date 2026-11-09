import type { WirePacket } from '../../mcp/telemetry/wire-packet';
import {
  describeTools,
  formatCost,
  formatLatency,
  formatTokens,
  humanWait,
  packetTitle,
} from './packet-format';

function packet(overrides: Partial<WirePacket> & { params?: unknown } = {}): WirePacket {
  const { params, ...rest } = overrides;
  return {
    id: 1,
    at: 0,
    correlationId: 'c-1',
    channel: 'mcp',
    method: 'tools/call',
    envelope: {
      request: {
        jsonrpc: '2.0',
        id: 1,
        method: rest.method ?? 'tools/call',
        ...(params !== undefined && { params }),
      },
    },
    status: 'ok',
    bytes: 10,
    ...rest,
  };
}

describe('formatLatency', () => {
  it('shows an ellipsis while pending', () => {
    expect(formatLatency(undefined)).toBe('…');
  });

  it('uses milliseconds below a second and seconds above', () => {
    expect(formatLatency(12.4)).toBe('12 ms');
    expect(formatLatency(1500)).toBe('1.5 s');
  });
});

describe('formatTokens', () => {
  it('shows a dash without usage', () => {
    expect(formatTokens(undefined)).toBe('—');
  });

  it('adds thinking tokens only when there are some', () => {
    expect(formatTokens({ input: 10, output: 5, thinking: 0 })).toBe('10 in · 5 out');
    expect(formatTokens({ input: 10, output: 5, thinking: 3 })).toBe('10 in · 5 out · 3 think');
  });
});

describe('formatCost', () => {
  it('shows a dash without a cost', () => {
    expect(formatCost(undefined)).toBe('—');
  });

  it('keeps four decimals for small amounts and three otherwise', () => {
    expect(formatCost(0.0012)).toBe('$0.0012');
    expect(formatCost(0.0345)).toBe('$0.035');
  });
});

describe('packetTitle', () => {
  it('names the tool of a call', () => {
    expect(packetTitle(packet({ params: { name: 'searchDeals', arguments: {} } }))).toBe(
      'tools/call · searchDeals',
    );
  });

  it('names the tool of an approval', () => {
    expect(
      packetTitle(
        packet({
          method: 'hitl/requested',
          channel: 'hitl',
          params: { toolName: 'terminateContract' },
        }),
      ),
    ).toBe('hitl/requested · terminateContract');
  });

  it('falls back to the model, then to the bare method', () => {
    expect(packetTitle(packet({ method: 'generateContent', model: 'gemini-3.8-flash' }))).toBe(
      'generateContent · gemini-3.8-flash',
    );
    expect(packetTitle(packet({ method: 'tools/list' }))).toBe('tools/list');
  });

  it('ignores params without a string name', () => {
    expect(packetTitle(packet({ method: 'tools/list', params: { name: 3 } }))).toBe('tools/list');
  });
});

describe('humanWait', () => {
  it('adds up resolved approvals only', () => {
    const packets = [
      packet({ method: 'hitl/requested', channel: 'hitl' }),
      packet({ method: 'hitl/resolved', channel: 'hitl', latencyMs: 1200 }),
      packet({ method: 'hitl/resolved', channel: 'hitl', latencyMs: 800 }),
      packet({ method: 'hitl/resolved', channel: 'hitl' }),
      packet({ method: 'tools/call', latencyMs: 50 }),
    ];
    expect(humanWait(packets)).toEqual({ count: 2, totalMs: 2000 });
  });

  it('is zero without approvals', () => {
    expect(humanWait([])).toEqual({ count: 0, totalMs: 0 });
  });
});

describe('describeTools', () => {
  const tools = [
    {
      name: 'alpha',
      description: 'first',
      annotations: { readOnlyHint: true, consequentialHint: false },
    },
    {
      name: 'beta',
      title: 'Beta',
      description: 'second',
      inputSchema: { type: 'object' as const },
    },
  ];

  it('lists the hints that are switched on', () => {
    const [alpha, beta] = describeTools(tools, null);
    expect(alpha?.hints).toEqual(['readOnlyHint']);
    expect(beta?.hints).toEqual([]);
    expect(beta?.title).toBe('Beta');
    expect(beta?.inputSchema).toEqual({ type: 'object' });
  });

  it('flags the tools added by the last change', () => {
    const rows = describeTools(tools, { added: ['beta'], removed: [], version: 2 });
    expect(rows.map((row) => row.isNew)).toEqual([false, true]);
  });
});
