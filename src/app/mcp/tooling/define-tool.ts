import { inject, type WebMcpToolDescriptor } from '@angular/core';
import { CLOCK } from '../../core/util/clock';
import type { JsonSchema } from '../schema/validate-args';
import { HUMAN_APPROVAL_GATE, type ApprovalRequest } from './approval-gate';
import { requireApproval } from './with-human-approval';
import { takeSnapshot, type Snapshotter } from './with-snapshot';
import { TOOL_TELEMETRY, type ToolStatus } from './with-telemetry';
import { validateToolArgs } from './with-validation';

export interface ToolContext {
  signal: AbortSignal;
  now(): Date;
  snapshotId?: string;
}

export interface ToolDefinition<A, D = void> {
  name: string;
  title?: string;
  description: string;
  inputSchema: JsonSchema;
  annotations?: WebMcpToolDescriptor['annotations'];
  deps?: () => D;
  risk?: (args: A) => ApprovalRequest | null;
  snapshot?: Snapshotter;
  snapshotLabel?: (args: A) => string;
  run: (args: A, ctx: ToolContext, deps: D) => unknown;
}

export interface ToolResult {
  content: { type: 'text'; text: string }[];
  isError?: true;
}

/** Registries hide thrown errors behind a generic failure, so failures travel as results the model can read. */
export function toErrorResult(message: string): ToolResult {
  return { content: [{ type: 'text', text: message }], isError: true };
}

const INSTRUMENTED = new Set<string>();

/** True for tools built by defineTool, which record their own telemetry span. */
export function isSelfInstrumented(toolName: string): boolean {
  return INSTRUMENTED.has(toolName);
}

export function toToolResult(value: unknown): ToolResult {
  return { content: [{ type: 'text', text: JSON.stringify(value ?? null) }] };
}

/** Wraps a tool body in telemetry, validation, human approval and snapshot middleware. */
export function defineTool<A, D = void>(def: ToolDefinition<A, D>): WebMcpToolDescriptor {
  INSTRUMENTED.add(def.name);
  return {
    name: def.name,
    ...(def.title !== undefined && { title: def.title }),
    description: def.description,
    inputSchema: def.inputSchema,
    ...(def.annotations !== undefined && { annotations: def.annotations }),
    execute: async (rawArgs: unknown, client?: { signal?: AbortSignal }) => {
      const telemetry = inject(TOOL_TELEMETRY);
      const gate = inject(HUMAN_APPROVAL_GATE, { optional: true });
      const clock = inject(CLOCK);
      const deps = def.deps?.() as D;
      const ctx: ToolContext = {
        signal: client?.signal ?? new AbortController().signal,
        now: clock,
      };

      const startedAt = clock().getTime();
      const span = telemetry.begin(def.name, rawArgs);
      const finish = (status: ToolStatus, detail: { error?: string; result?: unknown } = {}) =>
        span.end(status, { latencyMs: clock().getTime() - startedAt, ...detail });

      try {
        validateToolArgs(def.name, def.inputSchema, rawArgs);
        const args = (rawArgs ?? {}) as A;

        const request = def.risk?.(args) ?? null;
        if (request) {
          const rejection = await requireApproval(gate, request, ctx.signal);
          if (rejection) {
            finish('rejected', { result: rejection });
            return toToolResult(rejection);
          }
        }

        if (def.snapshot) {
          ctx.snapshotId = takeSnapshot(
            { target: def.snapshot, label: def.snapshotLabel ?? (() => def.title ?? def.name) },
            args,
          );
        }
        const value = await def.run(args, ctx, deps);
        finish('ok', { result: value ?? null });
        return toToolResult(value);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        finish('error', { error: message });
        return toErrorResult(message);
      }
    },
  };
}
