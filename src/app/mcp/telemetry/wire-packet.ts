export type WireChannel = 'mcp' | 'llm' | 'hitl' | 'human';

export type WireMethod =
  | 'tools/list'
  | 'tools/call'
  | 'notifications/tools/list_changed'
  | 'generateContent'
  | 'hitl/requested'
  | 'hitl/resolved'
  | 'human/undo';

export type WireStatus = 'pending' | 'ok' | 'error' | 'rejected';

export interface TokenUsage {
  input: number;
  output: number;
  thinking: number;
}

export interface JsonRpcRequest {
  jsonrpc: '2.0';
  id?: number;
  method: WireMethod;
  params?: unknown;
}

export interface JsonRpcResponse {
  jsonrpc: '2.0';
  id: number;
  result?: unknown;
  error?: { code: number; message: string };
}

export interface WireEnvelope {
  request: JsonRpcRequest;
  response?: JsonRpcResponse;
}

export interface WirePacket {
  id: number;
  at: number;
  correlationId: string;
  runId?: string;
  channel: WireChannel;
  method: WireMethod;
  envelope: WireEnvelope;
  status: WireStatus;
  latencyMs?: number;
  bytes: number;
  model?: string;
  tokens?: TokenUsage;
  costUsd?: number;
}

export const REDACTED = '•••';
export const MIN_SECRET_LENGTH = 8;

const KEY_QUERY = /(key=)[^&\s"'#]+/gi;
const SECRET_HEADER = /^x-goog-api-key$/i;

function redactString(text: string, secrets: readonly string[]): string {
  let result = text.replace(KEY_QUERY, `$1${REDACTED}`);
  for (const secret of secrets) {
    if (secret.length >= MIN_SECRET_LENGTH) {
      result = result.split(secret).join(REDACTED);
    }
  }
  return result;
}

/** Deep-copies a JSON value, masking the Gemini key header, `key=` query values and raw secrets. */
export function redactSecrets<T>(value: T, secrets: readonly string[] = []): T {
  return redactValue(value, secrets) as T;
}

function redactValue(value: unknown, secrets: readonly string[]): unknown {
  if (typeof value === 'string') {
    return redactString(value, secrets);
  }
  if (Array.isArray(value)) {
    return value.map((item) => redactValue(item, secrets));
  }
  if (value !== null && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value).map(([name, item]) => [
        redactString(name, secrets),
        SECRET_HEADER.test(name) ? REDACTED : redactValue(item, secrets),
      ]),
    );
  }
  return value;
}

export function byteLength(value: unknown): number {
  return new TextEncoder().encode(JSON.stringify(value) ?? '').length;
}
