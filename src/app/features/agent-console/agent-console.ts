import {
  Component,
  afterRenderEffect,
  computed,
  inject,
  linkedSignal,
  untracked,
  viewChild,
  type ElementRef,
} from '@angular/core';
import { disabled, form, FormField } from '@angular/forms/signals';
import { MatButton, MatIconButton } from '@angular/material/button';
import { MatIcon } from '@angular/material/icon';
import { AgentSessionStore, type SessionStatus } from '../../mcp/agent/agent-session-store';
import {
  DEFAULT_MODEL_ID,
  findModel,
  type GeminiModelId,
} from '../../mcp/agent/gemini/gemini-models';
import { IsolatedRunner } from '../lab/isolated-run';
import { LayoutStore } from '../layout/layout-store';
import { ApiKeyDialogLauncher } from '../settings/api-key-dialog-launcher';
import { SettingsStore } from '../settings/settings-store';
import { DEMO_PROMPTS, type DemoPrompt } from './demo-prompts';
import { PresenterActions } from './presenter-actions';
import { TranscriptItem, type ErrorFix } from './transcript-item';

const STATUS_LABELS: Readonly<Record<SessionStatus, string>> = {
  idle: 'Ready',
  running: 'Working…',
  'awaiting-approval': 'Waiting for your approval',
  error: 'Last run failed',
};

@Component({
  selector: 'app-agent-console',
  imports: [FormField, MatButton, MatIcon, MatIconButton, TranscriptItem],
  templateUrl: './agent-console.html',
  host: { class: 'block' },
})
export class AgentConsole {
  protected readonly session = inject(AgentSessionStore);
  protected readonly settings = inject(SettingsStore);
  protected readonly layout = inject(LayoutStore);
  private readonly presenter = inject(PresenterActions);
  private readonly launcher = inject(ApiKeyDialogLauncher);
  private readonly runner = inject(IsolatedRunner);

  protected readonly chips = DEMO_PROMPTS;

  protected readonly canRun = this.settings.canUseAgent;
  protected readonly locked = computed(
    () => !this.canRun() || this.session.running() || this.runner.evalMode(),
  );
  protected readonly statusLabel = computed(() => STATUS_LABELS[this.session.status()]);

  protected readonly model = linkedSignal<GeminiModelId, GeminiModelId>({
    source: () => this.presenter.draft()?.model ?? this.settings.model(),
    computation: (next) => next,
  });
  protected readonly modelInfo = computed(() => findModel(this.model()));

  protected readonly entry = linkedSignal(() => ({ prompt: this.presenter.draft()?.text ?? '' }));
  protected readonly promptForm = form(this.entry, (path) => {
    disabled(path.prompt, () => this.locked());
  });

  private readonly log = viewChild<ElementRef<HTMLElement>>('log');
  private readonly prompt = viewChild<ElementRef<HTMLTextAreaElement>>('prompt');
  private readonly draftNonce = computed(() => this.presenter.draft()?.nonce);

  constructor() {
    afterRenderEffect(() => {
      const nonce = this.draftNonce();
      const element = this.prompt()?.nativeElement;
      if (nonce !== undefined && element && !untracked(this.locked)) {
        element.focus();
      }
    });
    afterRenderEffect(() => {
      this.session.transcript();
      const element = this.log()?.nativeElement;
      if (element) {
        element.scrollTop = element.scrollHeight;
      }
    });
  }

  protected send(): void {
    const text = this.entry().prompt.trim();
    if (text === '' || this.locked()) {
      return;
    }
    this.entry.set({ prompt: '' });
    void this.session.run(text, { model: this.model() });
  }

  protected submitOnEnter(event: Event): void {
    if ((event as KeyboardEvent).isComposing) {
      return;
    }
    event.preventDefault();
    this.send();
  }

  protected runChip(chip: DemoPrompt): void {
    if (this.locked()) {
      return;
    }
    this.model.set(chip.model);
    void this.session.run(chip.prompt, { model: chip.model });
  }

  protected applyFix(fix: ErrorFix): void {
    if (fix === 'open-key-dialog') {
      void this.launcher.open();
      return;
    }
    this.settings.setModel(DEFAULT_MODEL_ID);
    this.model.set(DEFAULT_MODEL_ID);
  }

  protected openKeyDialog(): void {
    void this.launcher.open();
  }
}
