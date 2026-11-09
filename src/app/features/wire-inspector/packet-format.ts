import type { ToolsChange } from '../../mcp/agent/mcp-tool-gateway';
import type { RegistryToolInfo } from '../../mcp/registry/model-context';
import type { JsonSchema } from '../../mcp/schema/validate-args';
import type {
  TokenUsage,
  WireChannel,
  WirePacket,
  WireStatus,
} from '../../mcp/telemetry/wire-packet';

export const CHANNEL_LABELS: Readonly<Record<WireChannel, string>> = {
  mcp: 'MCP',
  llm: 'LLM',
  hitl: 'HITL',
  human: 'Human',
};

export const CHANNEL_STYLES: Readonly<Record<WireChannel, string>> = {
  mcp: 'border-primary text-primary',
  llm: 'border-[var(--mat-sys-tertiary)] text-[var(--mat-sys-tertiary)]',
  hitl: 'border-[var(--mat-sys-secondary)] text-[var(--mat-sys-secondary)]',
  human: 'border-outline-variant text-on-surface-variant',
};

export const STATUS_LABELS: Readonly<Record<WireStatus, string>> = {
  pending: 'Pending',
  ok: 'OK',
  error: 'Error',
  rejected: 'Rejected',
};

export const STATUS_STYLES: Readonly<Record<WireStatus, string>> = {
  pending: 'text-on-surface-variant',
  ok: 'text-on-surface',
  error: 'text-error',
  rejected: 'text-[var(--mat-sys-tertiary)]',
};

export function formatLatency(ms: number | undefined): string {
  if (ms === undefined) {
    return '…';
  }
  return ms < 1000 ? `${Math.round(ms)} ms` : `${(ms / 1000).toFixed(1)} s`;
}

export function formatTokens(tokens: TokenUsage | undefined): string {
  if (!tokens) {
    return '—';
  }
  const base = `${tokens.input} in · ${tokens.output} out`;
  return tokens.thinking > 0 ? `${base} · ${tokens.thinking} think` : base;
}

export function formatCost(costUsd: number | undefined): string {
  if (costUsd === undefined) {
    return '—';
  }
  return costUsd < 0.01 ? `$${costUsd.toFixed(4)}` : `$${costUsd.toFixed(3)}`;
}

function readString(value: unknown, key: string): string | undefined {
  const field = (value as Record<string, unknown> | null | undefined)?.[key];
  return typeof field === 'string' ? field : undefined;
}

export function packetTitle(packet: WirePacket): string {
  const params = packet.envelope.request.params;
  const subject = readString(params, 'name') ?? readString(params, 'toolName') ?? packet.model;
  return subject === undefined ? packet.method : `${packet.method} · ${subject}`;
}

export interface HumanWait {
  count: number;
  totalMs: number;
}

export function humanWait(packets: readonly WirePacket[]): HumanWait {
  const resolved = packets.filter(
    (packet) => packet.method === 'hitl/resolved' && packet.latencyMs !== undefined,
  );
  return {
    count: resolved.length,
    totalMs: resolved.reduce((sum, packet) => sum + (packet.latencyMs ?? 0), 0),
  };
}

export interface ToolRow {
  name: string;
  title: string | undefined;
  description: string;
  hints: string[];
  inputSchema: JsonSchema | undefined;
  isNew: boolean;
}

export function describeTools(
  tools: readonly RegistryToolInfo[],
  change: ToolsChange | null,
): ToolRow[] {
  const added = new Set(change?.added ?? []);
  return tools.map((tool) => ({
    name: tool.name,
    title: tool.title,
    description: tool.description,
    hints: Object.entries(tool.annotations ?? {})
      .filter(([, enabled]) => enabled === true)
      .map(([hint]) => hint),
    inputSchema: tool.inputSchema,
    isNew: added.has(tool.name),
  }));
}
