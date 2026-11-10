import { InjectionToken } from '@angular/core';

export interface GenAiFunctionCall {
  id?: string;
  name?: string;
  args?: Record<string, unknown>;
}

export interface GenAiFunctionResponse {
  id?: string;
  name: string;
  response: Record<string, unknown>;
}

export interface GenAiPart {
  text?: string;
  thought?: boolean;
  thoughtSignature?: string;
  functionCall?: GenAiFunctionCall;
  functionResponse?: GenAiFunctionResponse;
}

export interface GenAiUsage {
  promptTokenCount?: number;
  candidatesTokenCount?: number;
  thoughtsTokenCount?: number;
  toolUsePromptTokenCount?: number;
}

export interface GenAiChunk {
  candidates?: { content?: { parts?: GenAiPart[] } }[];
  usageMetadata?: GenAiUsage;
}

export interface GenAiFunctionDeclaration {
  name: string;
  description: string;
  parametersJsonSchema: unknown;
}

export interface GenAiConfig {
  systemInstruction?: string;
  tools?: { functionDeclarations: GenAiFunctionDeclaration[] }[];
  thinkingConfig?: { thinkingLevel?: string; includeThoughts?: boolean };
  automaticFunctionCalling?: { disable?: boolean };
  toolConfig?: { functionCallingConfig?: { mode?: string } };
  abortSignal?: AbortSignal;
}

export interface GenAiChat {
  sendMessageStream(params: {
    message: GenAiPart[];
    config?: GenAiConfig;
  }): Promise<AsyncIterable<GenAiChunk>>;
}

export interface GenAiClient {
  models: {
    list(params?: { config?: { pageSize?: number; abortSignal?: AbortSignal } }): Promise<unknown>;
  };
  chats: {
    create(params: { model: string; config?: GenAiConfig }): GenAiChat;
  };
}

export type GenAiClientFactory = (apiKey: string) => Promise<GenAiClient>;

export const GENAI_CLIENT_FACTORY = new InjectionToken<GenAiClientFactory>('GENAI_CLIENT_FACTORY', {
  providedIn: 'root',
  factory: () => async (apiKey) => {
    const { GoogleGenAI } = await import('@google/genai');
    return new GoogleGenAI({ apiKey }) as unknown as GenAiClient;
  },
});
