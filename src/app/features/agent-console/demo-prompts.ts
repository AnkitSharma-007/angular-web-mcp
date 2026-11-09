import type { GeminiModelId } from '../../mcp/agent/gemini/gemini-models';

export type ActId = 'act1' | 'act2' | 'act3' | 'act4';

export type PromptHotkey = '1' | '2' | '3' | '4';

export interface DemoPrompt {
  id: ActId;
  hotkey: PromptHotkey;
  label: string;
  prompt: string;
  model: GeminiModelId;
}

export const DEMO_PROMPTS: readonly DemoPrompt[] = [
  {
    id: 'act1',
    hotkey: '1',
    label: 'Context',
    prompt: 'Give me a pipeline summary — where are we exposed this quarter?',
    model: 'gemini-3.5-flash-lite',
  },
  {
    id: 'act2',
    hotkey: '2',
    label: 'Multi-step',
    prompt:
      'Show EMEA deals in Negotiation, give them 10% off, and move anything above 70% probability to Closed Won.',
    model: 'gemini-3.8-flash',
  },
  {
    id: 'act3',
    hotkey: '3',
    label: 'Signal Form',
    prompt:
      'Draft a 24-month Enterprise renewal for Konkan Freight, 250 seats, starting mid-December.',
    model: 'gemini-3.8-flash',
  },
  {
    id: 'act4',
    hotkey: '4',
    label: 'Governance',
    prompt: 'End of quarter: give Arcadia Bank 25% off and terminate the Monsoon Retail contract.',
    model: 'gemini-3.8-flash',
  },
];

export function demoPromptForKey(key: string): DemoPrompt | undefined {
  return DEMO_PROMPTS.find((entry) => entry.hotkey === key);
}

export function demoPromptFor(id: ActId): DemoPrompt {
  const found = DEMO_PROMPTS.find((entry) => entry.id === id);
  if (!found) {
    throw new Error(`Unknown demo prompt: ${id}`);
  }
  return found;
}
