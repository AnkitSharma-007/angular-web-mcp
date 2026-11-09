import { CurrencyPipe, DecimalPipe, JsonPipe } from '@angular/common';
import { Component, computed, input, output } from '@angular/core';
import { MatButton } from '@angular/material/button';
import { MatIcon } from '@angular/material/icon';
import type { AgentErrorKind } from '../../mcp/agent/agent-events';
import type { TranscriptEntry } from '../../mcp/agent/agent-session-store';
import { DEFAULT_MODEL_ID, findModel } from '../../mcp/agent/gemini/gemini-models';

export type ErrorFix = 'open-key-dialog' | 'use-default-model';

interface ErrorGuide {
  title: string;
  hint: string;
  fix?: { action: ErrorFix; label: string };
}

const DEFAULT_PERSONA = findModel(DEFAULT_MODEL_ID)?.persona ?? DEFAULT_MODEL_ID;

const ERROR_GUIDES: Readonly<Record<AgentErrorKind, ErrorGuide>> = {
  auth: {
    title: 'The API key was rejected',
    hint: 'Check that the key is correct and allowed to call the Generative Language API.',
    fix: { action: 'open-key-dialog', label: 'Open API key dialog' },
  },
  quota: {
    title: 'Rate limit or quota reached',
    hint: 'Wait a minute and try again, or pick a model with more headroom.',
  },
  'model-access': {
    title: 'This key cannot use the selected model',
    hint: 'Some models need billing enabled on the key.',
    fix: { action: 'use-default-model', label: `Switch to ${DEFAULT_PERSONA}` },
  },
  network: {
    title: 'Could not reach Gemini',
    hint: 'Check the connection and try again.',
  },
  'max-steps': {
    title: 'The agent ran out of steps',
    hint: 'Ask for a smaller change, or break the request into parts.',
  },
  unknown: {
    title: 'The run failed',
    hint: 'The message below comes from the API.',
  },
};

@Component({
  selector: 'app-transcript-item',
  imports: [CurrencyPipe, DecimalPipe, JsonPipe, MatButton, MatIcon],
  templateUrl: './transcript-item.html',
  host: { class: 'block' },
})
export class TranscriptItem {
  readonly entry = input.required<TranscriptEntry>();
  readonly fix = output<ErrorFix>();

  protected readonly userText = computed(() => {
    const entry = this.entry();
    return entry.kind === 'user' ? entry.text : null;
  });

  protected readonly event = computed(() => {
    const entry = this.entry();
    return entry.kind === 'event' ? entry.event : null;
  });

  protected guide(kind: AgentErrorKind): ErrorGuide {
    return ERROR_GUIDES[kind];
  }

  protected emojiOf(modelId: string): string {
    return findModel(modelId)?.emoji ?? '';
  }

  protected total(usage: { input: number; output: number; thinking: number }): number {
    return usage.input + usage.output + usage.thinking;
  }
}
