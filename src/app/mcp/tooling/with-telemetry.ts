import { InjectionToken, inject } from '@angular/core';
import { WireTelemetryStore } from '../telemetry/wire-telemetry-store';

export type ToolStatus = 'ok' | 'error' | 'rejected';

export interface ToolSpanResult {
  latencyMs: number;
  error?: string;
  result?: unknown;
}

export interface ToolSpan {
  end(status: ToolStatus, result: ToolSpanResult): void;
}

export interface ToolTelemetry {
  begin(toolName: string, args: unknown): ToolSpan;
}

type PacketSink = Pick<InstanceType<typeof WireTelemetryStore>, 'begin' | 'end'>;

export function createStoreTelemetry(store: PacketSink): ToolTelemetry {
  return {
    begin: (toolName, args) => {
      const id = store.begin({
        channel: 'mcp',
        method: 'tools/call',
        params: { name: toolName, arguments: args ?? {} },
      });
      return {
        end: (status, { latencyMs, error, result }) =>
          store.end(id, {
            status,
            latencyMs,
            ...(error !== undefined && { error }),
            ...(result !== undefined && { result }),
          }),
      };
    },
  };
}

export const TOOL_TELEMETRY = new InjectionToken<ToolTelemetry>('TOOL_TELEMETRY', {
  providedIn: 'root',
  factory: () => createStoreTelemetry(inject(WireTelemetryStore)),
});
