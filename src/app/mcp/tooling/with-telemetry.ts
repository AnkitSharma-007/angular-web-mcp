import { InjectionToken } from '@angular/core';

export type ToolStatus = 'ok' | 'error' | 'rejected';

export interface ToolSpanResult {
  latencyMs: number;
  error?: string;
}

export interface ToolSpan {
  end(status: ToolStatus, result: ToolSpanResult): void;
}

export interface ToolTelemetry {
  begin(toolName: string, args: unknown): ToolSpan;
}

const NOOP_SPAN: ToolSpan = { end: () => undefined };

export const TOOL_TELEMETRY = new InjectionToken<ToolTelemetry>('TOOL_TELEMETRY', {
  factory: () => ({ begin: () => NOOP_SPAN }),
});
