import type { TokenUsage } from '../../telemetry/wire-packet';

export type GeminiModelId = 'gemini-3.5-flash-lite' | 'gemini-3.8-flash';
export type ThinkingLevelName = 'low' | 'medium';
export type ModelPersona = 'Sprinter' | 'Operator';

export interface PriceEntry {
  from: string;
  inputPerM: number;
  outputPerM: number;
}

export interface GeminiModel {
  id: GeminiModelId;
  persona: ModelPersona;
  emoji: string;
  thinkingLevel: ThinkingLevelName;
  role: string;
  priceSchedule: readonly PriceEntry[];
}

export const DEFAULT_MODEL_ID: GeminiModelId = 'gemini-3.8-flash';

export const GEMINI_MODELS: readonly GeminiModel[] = [
  {
    id: 'gemini-3.5-flash-lite',
    persona: 'Sprinter',
    emoji: '⚡',
    thinkingLevel: 'low',
    role: 'Fast reads and quick answers',
    priceSchedule: [{ from: '2000-01-01', inputPerM: 0.3, outputPerM: 2.5 }],
  },
  {
    id: 'gemini-3.8-flash',
    persona: 'Operator',
    emoji: '🛠️',
    thinkingLevel: 'medium',
    role: 'Multi-step tool work',
    priceSchedule: [
      { from: '2000-01-01', inputPerM: 0.75, outputPerM: 3.75 },
      { from: '2027-01-01', inputPerM: 1.5, outputPerM: 7.5 },
    ],
  },
];

export function findModel(id: string): GeminiModel | undefined {
  return GEMINI_MODELS.find((model) => model.id === id);
}

export function priceAt(model: GeminiModel, at: Date): PriceEntry {
  const day = at.toISOString().slice(0, 10);
  const current = model.priceSchedule.filter((entry) => entry.from <= day).at(-1);
  return current ?? model.priceSchedule[0]!;
}

/** Thinking tokens are billed at the output rate. */
export function estimateCostUsd(modelId: string, usage: TokenUsage, at: Date): number | undefined {
  const model = findModel(modelId);
  if (!model) {
    return undefined;
  }
  const price = priceAt(model, at);
  return (
    (usage.input * price.inputPerM + (usage.output + usage.thinking) * price.outputPerM) / 1_000_000
  );
}
