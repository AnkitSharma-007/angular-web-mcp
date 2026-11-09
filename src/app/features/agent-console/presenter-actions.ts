import { Injector, Service, afterNextRender, inject, signal } from '@angular/core';
import { AgentSessionStore } from '../../mcp/agent/agent-session-store';
import type { GeminiModelId } from '../../mcp/agent/gemini/gemini-models';
import { WireTelemetryStore } from '../../mcp/telemetry/wire-telemetry-store';
import { LayoutStore } from '../layout/layout-store';
import { demoPromptForKey } from './demo-prompts';

export interface PromptDraft {
  text: string;
  model: GeminiModelId;
  nonce: number;
}

const TYPING_TAGS = new Set(['INPUT', 'TEXTAREA', 'SELECT']);
const EDITABLE = '[contenteditable=""],[contenteditable="true"]';

export function isTypingTarget(target: EventTarget | null): boolean {
  const element = target as HTMLElement | null;
  if (!element || typeof element.tagName !== 'string') {
    return false;
  }
  return TYPING_TAGS.has(element.tagName) || element.closest(EDITABLE) !== null;
}

@Service()
export class PresenterActions {
  private readonly layout = inject(LayoutStore);
  private readonly session = inject(AgentSessionStore);
  private readonly telemetry = inject(WireTelemetryStore);
  private readonly injector = inject(Injector);

  private readonly draftState = signal<PromptDraft | null>(null);
  private readonly resetHandlers = new Set<() => void>();
  private nonce = 0;

  readonly draft = this.draftState.asReadonly();

  fillChip(key: string): boolean {
    const chip = demoPromptForKey(key);
    if (!chip) {
      return false;
    }
    this.draftState.set({ text: chip.prompt, model: chip.model, nonce: ++this.nonce });
    this.layout.openConsole();
    return true;
  }

  registerReset(handler: () => void): () => void {
    this.resetHandlers.add(handler);
    return () => this.resetHandlers.delete(handler);
  }

  reset(): void {
    this.session.clear();
    this.draftState.set(null);
    this.resetHandlers.forEach((handler) => handler());
    this.telemetry.clear();
    // Tools unregistered by the reset (the proposal drawer) report a list change after the next render.
    afterNextRender(() => queueMicrotask(() => this.telemetry.clear()), {
      injector: this.injector,
    });
  }

  handleKey(event: KeyboardEvent): boolean {
    if (event.defaultPrevented || event.ctrlKey || event.metaKey || event.altKey) {
      return false;
    }
    if (isTypingTarget(event.target)) {
      return false;
    }
    const handled = this.dispatch(event);
    if (handled) {
      event.preventDefault();
    }
    return handled;
  }

  private dispatch(event: KeyboardEvent): boolean {
    if (event.key === '`') {
      this.layout.toggleInspector();
      return true;
    }
    if (event.key === 'R' && event.shiftKey) {
      this.reset();
      return true;
    }
    return !event.shiftKey && this.fillChip(event.key);
  }
}
