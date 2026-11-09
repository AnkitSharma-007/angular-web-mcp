import type {
  GenAiChat,
  GenAiChunk,
  GenAiClient,
  GenAiConfig,
  GenAiPart,
  GenAiUsage,
} from '../app/mcp/agent/gemini/genai-client';

export interface FakeCall {
  name: string;
  args?: Record<string, unknown>;
  id?: string;
}

export interface FakeTurn {
  thoughts?: string[];
  text?: string | string[];
  functionCalls?: FakeCall[];
  usage?: GenAiUsage;
  error?: unknown;
  hold?: Promise<void>;
}

export interface FakeRequest {
  model: string;
  message: GenAiPart[];
  config: GenAiConfig | undefined;
  chat: FakeChat;
}

export interface FakeContent {
  role: 'user' | 'model';
  parts: GenAiPart[];
}

export type FakeScript = FakeTurn | ((request: FakeRequest) => FakeTurn);

export class FakeApiError extends Error {
  constructor(
    readonly status: number,
    message = `HTTP ${status}`,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

export function abortError(): Error {
  const error = new Error('The operation was aborted');
  error.name = 'AbortError';
  return error;
}

export class FakeChat implements GenAiChat {
  readonly history: FakeContent[] = [];

  constructor(
    readonly model: string,
    readonly createConfig: GenAiConfig | undefined,
    private readonly owner: FakeGenAI,
  ) {}

  async sendMessageStream(params: {
    message: GenAiPart[];
    config?: GenAiConfig;
  }): Promise<AsyncIterable<GenAiChunk>> {
    const request: FakeRequest = {
      model: this.model,
      message: params.message,
      config: params.config,
      chat: this,
    };
    this.owner.requests.push(request);
    this.history.push({ role: 'user', parts: params.message });

    const signal = params.config?.abortSignal;
    if (signal?.aborted) {
      throw abortError();
    }
    const entry = this.owner.nextScript();
    if (entry === undefined) {
      throw new Error('FakeGenAI: no scripted turn left');
    }
    const turn = typeof entry === 'function' ? entry(request) : entry;
    if (turn.error !== undefined) {
      throw turn.error;
    }
    return this.stream(turn, signal);
  }

  private async *stream(
    turn: FakeTurn,
    signal: AbortSignal | undefined,
  ): AsyncGenerator<GenAiChunk> {
    if (turn.hold) {
      await Promise.race([
        turn.hold,
        new Promise<never>((_, reject) => {
          signal?.addEventListener('abort', () => reject(abortError()), { once: true });
        }),
      ]);
    }
    const parts: GenAiPart[] = [];
    for (const thought of turn.thoughts ?? []) {
      const part = { text: thought, thought: true };
      parts.push(part);
      yield chunk([part]);
    }
    const deltas =
      turn.text === undefined ? [] : Array.isArray(turn.text) ? turn.text : [turn.text];
    for (const delta of deltas) {
      const part = { text: delta };
      parts.push(part);
      yield chunk([part]);
    }
    const calls = (turn.functionCalls ?? []).map((call, index): GenAiPart => ({
      functionCall: {
        id: call.id ?? `call-${this.history.length}-${index}`,
        name: call.name,
        args: call.args ?? {},
      },
      thoughtSignature: `sig-${this.history.length}-${index}`,
    }));
    if (calls.length > 0) {
      parts.push(...calls);
      yield chunk(calls);
    }
    this.history.push({ role: 'model', parts });
    yield { usageMetadata: turn.usage ?? { promptTokenCount: 10, candidatesTokenCount: 5 } };
  }
}

function chunk(parts: GenAiPart[]): GenAiChunk {
  return { candidates: [{ content: { parts } }] };
}

export class FakeGenAI implements GenAiClient {
  readonly requests: FakeRequest[] = [];
  readonly createdChats: FakeChat[] = [];
  readonly listCalls: { pageSize?: number; abortSignal?: AbortSignal }[] = [];
  listError: unknown = null;
  listHold: Promise<void> | null = null;

  private readonly script: FakeScript[];

  constructor(
    script: FakeScript[] = [],
    readonly apiKey = 'test-key',
  ) {
    this.script = [...script];
  }

  nextScript(): FakeScript | undefined {
    return this.script.shift();
  }

  push(...turns: FakeScript[]): void {
    this.script.push(...turns);
  }

  readonly models = {
    list: async (params?: { config?: { pageSize?: number; abortSignal?: AbortSignal } }) => {
      this.listCalls.push({ ...params?.config });
      const signal = params?.config?.abortSignal;
      if (this.listHold) {
        await Promise.race([
          this.listHold,
          new Promise<never>((_, reject) => {
            signal?.addEventListener('abort', () => reject(abortError()), { once: true });
          }),
        ]);
      }
      if (this.listError !== null) {
        throw this.listError;
      }
      return [];
    },
  };

  readonly chats = {
    create: (params: { model: string; config?: GenAiConfig }): GenAiChat => {
      const chat = new FakeChat(params.model, params.config, this);
      this.createdChats.push(chat);
      return chat;
    },
  };
}

export function fakeGenAiFactory(client: FakeGenAI): (apiKey: string) => Promise<GenAiClient> {
  return () => Promise.resolve(client);
}
