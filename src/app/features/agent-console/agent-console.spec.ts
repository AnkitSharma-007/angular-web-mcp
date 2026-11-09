import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { expectNoA11yViolations } from '../../../testing/a11y';
import { FakeApiError, FakeGenAI, fakeGenAiFactory } from '../../../testing/fake-genai';
import type { AgentEvent } from '../../mcp/agent/agent-events';
import { GeminiAgent, type AgentRunOptions } from '../../mcp/agent/gemini/gemini-agent';
import { DEFAULT_MODEL_ID } from '../../mcp/agent/gemini/gemini-models';
import { GENAI_CLIENT_FACTORY } from '../../mcp/agent/gemini/genai-client';
import { HUMAN_APPROVAL_GATE, type ApprovalRequest } from '../../mcp/tooling/approval-gate';
import { IsolatedRunner } from '../lab/isolated-run';
import { LayoutStore } from '../layout/layout-store';
import { ApiKeyDialogLauncher } from '../settings/api-key-dialog-launcher';
import { SettingsStore } from '../settings/settings-store';
import { AgentConsole } from './agent-console';
import { DEMO_PROMPTS } from './demo-prompts';
import { PresenterActions } from './presenter-actions';

type Script = (prompt: string, options: AgentRunOptions) => AsyncGenerator<AgentEvent>;

const DONE: AgentEvent = {
  type: 'done',
  usage: { input: 10, output: 5, thinking: 2 },
  costUsd: 0.01,
  model: 'gemini-3.8-flash',
  ms: 30,
};

function events(...list: AgentEvent[]): Script {
  return async function* () {
    yield* list;
  };
}

function gated(release: Promise<void>, ...list: AgentEvent[]): Script {
  return async function* (_, { signal }) {
    yield { type: 'text-delta', text: 'working' };
    await Promise.race([
      release,
      new Promise<void>((resolve) => signal.addEventListener('abort', () => resolve())),
    ]);
    if (!signal.aborted) {
      yield* list;
    }
  };
}

interface SetupOptions {
  script?: Script;
  key?: string | null;
  listError?: unknown;
}

function setup({
  script = events(DONE),
  key = 'AIza-test-key-0001',
  listError,
}: SetupOptions = {}) {
  localStorage.clear();
  sessionStorage.clear();
  const open = vi.fn().mockResolvedValue(true);
  const pending = signal<ApprovalRequest | null>(null);
  const evalMode = signal(false);
  const runs: { prompt: string; options: AgentRunOptions }[] = [];
  const fake = new FakeGenAI();
  if (listError !== undefined) {
    fake.listError = listError;
  }
  TestBed.configureTestingModule({
    providers: [
      { provide: GENAI_CLIENT_FACTORY, useValue: fakeGenAiFactory(fake) },
      { provide: ApiKeyDialogLauncher, useValue: { open } },
      { provide: IsolatedRunner, useValue: { evalMode } },
      { provide: HUMAN_APPROVAL_GATE, useValue: { pending, request: vi.fn() } },
      {
        provide: GeminiAgent,
        useValue: {
          run: (prompt: string, options: AgentRunOptions) => {
            runs.push({ prompt, options });
            return script(prompt, options);
          },
        },
      },
    ],
  });
  const settings = TestBed.inject(SettingsStore);
  if (key !== null) {
    settings.saveKey(key, false);
  }
  const fixture = TestBed.createComponent(AgentConsole);
  const root = fixture.nativeElement as HTMLElement;
  const q = <T extends HTMLElement>(testId: string) =>
    root.querySelector<T>(`[data-testid="${testId}"]`);
  const type = async (text: string) => {
    const input = q<HTMLTextAreaElement>('prompt');
    if (input) {
      input.value = text;
      input.dispatchEvent(new Event('input', { bubbles: true }));
    }
    await fixture.whenStable();
  };
  const press = (init: KeyboardEventInit) => {
    const event = new KeyboardEvent('keydown', {
      key: 'Enter',
      bubbles: true,
      cancelable: true,
      ...init,
    });
    q('prompt')?.dispatchEvent(event);
    return event;
  };
  return { fixture, root, q, type, press, runs, open, pending, settings, fake, evalMode };
}

const settle = async (fixture: { whenStable: () => Promise<unknown> }) => {
  await fixture.whenStable();
  await new Promise((resolve) => setTimeout(resolve));
  await fixture.whenStable();
};

describe('AgentConsole', () => {
  beforeAll(() => import('../../mcp/agent/gemini/gemini-agent'));

  afterEach(() => {
    localStorage.clear();
    sessionStorage.clear();
  });

  describe('chips and input', () => {
    it('shows one chip per act with its hotkey', async () => {
      const { fixture, q } = setup();
      await fixture.whenStable();
      for (const chip of DEMO_PROMPTS) {
        expect(q(`chip-${chip.id}`)?.textContent).toContain(chip.label);
        expect(q(`chip-${chip.id}`)?.textContent).toContain(chip.hotkey);
      }
    });

    it('runs a chip prompt with the chip model', async () => {
      const { fixture, q, runs } = setup();
      await fixture.whenStable();
      q<HTMLButtonElement>('chip-act1')?.click();
      await vi.waitFor(() => expect(runs).toHaveLength(1));
      await settle(fixture);
      expect(runs[0]?.prompt).toBe(DEMO_PROMPTS[0]?.prompt);
      expect(runs[0]?.options.model).toBe('gemini-3.5-flash-lite');
      expect(q('model-badge')?.getAttribute('data-model')).toBe('gemini-3.5-flash-lite');
    });

    it('sends the typed text on Enter and clears the input', async () => {
      const { fixture, q, type, press, runs } = setup();
      await fixture.whenStable();
      await type('  How many deals are at risk?  ');
      const event = press({});
      await settle(fixture);
      expect(event.defaultPrevented).toBe(true);
      expect(runs.map((run) => run.prompt)).toEqual(['How many deals are at risk?']);
      expect(runs[0]?.options.model).toBe(DEFAULT_MODEL_ID);
      expect(q<HTMLTextAreaElement>('prompt')?.value).toBe('');
    });

    it('adds a new line on Shift+Enter instead of sending', async () => {
      const { fixture, type, press, runs } = setup();
      await fixture.whenStable();
      await type('first line');
      const event = press({ shiftKey: true });
      await settle(fixture);
      expect(event.defaultPrevented).toBe(false);
      expect(runs).toHaveLength(0);
    });

    it('does not send while an input method is composing', async () => {
      const { fixture, type, press, runs } = setup();
      await fixture.whenStable();
      await type('こんにちは');
      press({ isComposing: true });
      await settle(fixture);
      expect(runs).toHaveLength(0);
    });

    it('does not send blank text', async () => {
      const { fixture, type, q, runs } = setup();
      await fixture.whenStable();
      await type('   ');
      q<HTMLButtonElement>('send')?.click();
      await settle(fixture);
      expect(runs).toHaveLength(0);
    });

    it('sends with the Send button', async () => {
      const { fixture, type, q, runs } = setup();
      await fixture.whenStable();
      await type('hello');
      q<HTMLButtonElement>('send')?.click();
      await settle(fixture);
      expect(runs.map((run) => run.prompt)).toEqual(['hello']);
    });

    it('fills the input from a presenter hotkey without running it', async () => {
      const { fixture, q, runs } = setup();
      TestBed.inject(PresenterActions).fillChip('3');
      await fixture.whenStable();
      expect(q<HTMLTextAreaElement>('prompt')?.value).toBe(DEMO_PROMPTS[2]?.prompt);
      expect(q('model-badge')?.getAttribute('data-model')).toBe('gemini-3.8-flash');
      expect(runs).toHaveLength(0);
    });

    it('goes back to the saved model and an empty input after a presenter reset', async () => {
      const { fixture, q } = setup();
      const presenter = TestBed.inject(PresenterActions);
      presenter.fillChip('1');
      await fixture.whenStable();
      presenter.reset();
      await fixture.whenStable();
      expect(q<HTMLTextAreaElement>('prompt')?.value).toBe('');
      expect(q('model-badge')?.getAttribute('data-model')).toBe(DEFAULT_MODEL_ID);
    });

    it('closes through the layout store', async () => {
      const { fixture, q } = setup();
      const layout = TestBed.inject(LayoutStore);
      layout.openConsole();
      await fixture.whenStable();
      q<HTMLButtonElement>('close')?.click();
      expect(layout.consoleOpen()).toBe(false);
    });
  });

  describe('while running', () => {
    function pausedRun() {
      let release!: () => void;
      const gate = new Promise<void>((resolve) => (release = resolve));
      return { release, script: gated(gate, DONE) };
    }

    it('disables the input and chips and offers Stop', async () => {
      const { script } = pausedRun();
      const { fixture, q } = setup({ script });
      await fixture.whenStable();
      q<HTMLButtonElement>('chip-act2')?.click();
      await settle(fixture);
      expect(q<HTMLTextAreaElement>('prompt')?.disabled).toBe(true);
      expect(q<HTMLButtonElement>('chip-act1')?.disabled).toBe(true);
      expect(q('send')).toBeNull();
      expect(q('stop')).not.toBeNull();
      expect(q('status')?.getAttribute('data-status')).toBe('running');
      expect(q('status')?.textContent).toContain('Working');
    });

    it('does not start a second run from a chip while one is running', async () => {
      const { script } = pausedRun();
      const { fixture, q, runs } = setup({ script });
      await fixture.whenStable();
      q<HTMLButtonElement>('chip-act2')?.click();
      await settle(fixture);
      q<HTMLButtonElement>('chip-act1')?.click();
      await settle(fixture);
      expect(runs).toHaveLength(1);
    });

    it('stops the run and gives the input back', async () => {
      const { script } = pausedRun();
      const { fixture, q, runs } = setup({ script });
      await fixture.whenStable();
      q<HTMLButtonElement>('chip-act2')?.click();
      await settle(fixture);
      q<HTMLButtonElement>('stop')?.click();
      await settle(fixture);
      expect(runs[0]?.options.signal.aborted).toBe(true);
      expect(q<HTMLTextAreaElement>('prompt')?.disabled).toBe(false);
      expect(q('send')).not.toBeNull();
      expect(q('status')?.getAttribute('data-status')).toBe('idle');
    });

    it('shows that it is waiting for the human while an approval is open', async () => {
      const { script } = pausedRun();
      const { fixture, q, pending } = setup({ script });
      await fixture.whenStable();
      q<HTMLButtonElement>('chip-act4')?.click();
      await settle(fixture);
      pending.set({ toolName: 'terminateContract', risk: 'critical', summary: 'Terminate' });
      await settle(fixture);
      expect(q('status')?.textContent).toContain('Waiting for your approval');
      expect(q('awaiting-approval')?.textContent).toContain('terminateContract');
    });

    it('clears the transcript', async () => {
      const { fixture, q } = setup();
      await fixture.whenStable();
      q<HTMLButtonElement>('chip-act1')?.click();
      await settle(fixture);
      expect(q('clear')?.hasAttribute('disabled')).toBe(false);
      q<HTMLButtonElement>('clear')?.click();
      await settle(fixture);
      expect(q('transcript')?.querySelectorAll('app-transcript-item')).toHaveLength(0);
    });
  });

  describe('rendering', () => {
    it('renders the prompt and every kind of event in order', async () => {
      const script = events(
        { type: 'thought', text: 'plan' },
        { type: 'tool-call', callId: 'c1', name: 'getPipelineSummary', args: {} },
        {
          type: 'tool-result',
          callId: 'c1',
          name: 'getPipelineSummary',
          result: { ok: 1 },
          ok: true,
          latencyMs: 4,
        },
        { type: 'tools-changed', added: ['draftDealProposal'], removed: [] },
        { type: 'text-delta', text: 'Pipeline is healthy.' },
        DONE,
      );
      const { fixture, q, root } = setup({ script });
      await fixture.whenStable();
      q<HTMLButtonElement>('chip-act1')?.click();
      await settle(fixture);
      const order = [...root.querySelectorAll('app-transcript-item > *')].map((node) =>
        node.getAttribute('data-testid'),
      );
      expect(order).toEqual([
        'user-message',
        'thought',
        'tool-call',
        'tool-result',
        'tools-changed',
        'agent-text',
        'done',
      ]);
    });

    it('opens the key dialog from an auth error card', async () => {
      const script = events({ type: 'error', kind: 'auth', message: 'API key not valid' });
      const { fixture, q, open } = setup({ script });
      await fixture.whenStable();
      q<HTMLButtonElement>('chip-act1')?.click();
      await settle(fixture);
      q<HTMLButtonElement>('error-fix')?.click();
      expect(open).toHaveBeenCalledOnce();
      expect(q('status')?.getAttribute('data-status')).toBe('error');
    });

    it('switches to the default model from a model-access error card', async () => {
      const script = events({ type: 'error', kind: 'model-access', message: 'no access' });
      const { fixture, q, settings } = setup({ script });
      settings.setModel('gemini-4-argon');
      await fixture.whenStable();
      expect(q('model-badge')?.getAttribute('data-model')).toBe('gemini-4-argon');
      q<HTMLButtonElement>('chip-act2')?.click();
      await settle(fixture);
      q<HTMLButtonElement>('error-fix')?.click();
      await settle(fixture);
      expect(settings.model()).toBe(DEFAULT_MODEL_ID);
      expect(q('model-badge')?.getAttribute('data-model')).toBe(DEFAULT_MODEL_ID);
    });
  });

  describe('during a lab run', () => {
    it('is locked while eval mode is on and unlocks afterwards', async () => {
      const { fixture, q, evalMode } = setup();
      await fixture.whenStable();
      evalMode.set(true);
      await fixture.whenStable();
      expect(q<HTMLTextAreaElement>('prompt')?.disabled).toBe(true);
      expect(q<HTMLButtonElement>('chip-act1')?.disabled).toBe(true);
      evalMode.set(false);
      await fixture.whenStable();
      expect(q<HTMLTextAreaElement>('prompt')?.disabled).toBe(false);
    });
  });

  describe('without a valid key', () => {
    it('is disabled and explains why when there is no key', async () => {
      const { fixture, q, runs } = setup({ key: null });
      await fixture.whenStable();
      expect(q('key-required')?.textContent).toContain('needs your own Gemini API key');
      expect(q<HTMLTextAreaElement>('prompt')?.disabled).toBe(true);
      expect(q<HTMLButtonElement>('send')?.disabled).toBe(true);
      expect(q<HTMLButtonElement>('chip-act1')?.disabled).toBe(true);
      q<HTMLButtonElement>('chip-act1')?.click();
      expect(runs).toHaveLength(0);
    });

    it('offers to add a key', async () => {
      const { fixture, q, open } = setup({ key: null });
      await fixture.whenStable();
      q<HTMLButtonElement>('add-key')?.click();
      expect(open).toHaveBeenCalledOnce();
    });

    it('is disabled when Google rejects the saved key', async () => {
      const { fixture, q, settings } = setup({ listError: new FakeApiError(401, 'bad key') });
      await vi.waitFor(() => {
        TestBed.tick();
        expect(settings.keyStatus()).toBe('invalid');
      });
      await fixture.whenStable();
      expect(q('key-required')?.textContent).toContain('rejected');
      expect(q('add-key')?.textContent).toContain('Replace API key');
      expect(q<HTMLTextAreaElement>('prompt')?.disabled).toBe(true);
    });

    it('stays usable while the key is still being checked or the check could not run', async () => {
      const { fixture, q, settings } = setup({ listError: new FakeApiError(503, 'down') });
      await vi.waitFor(() => {
        TestBed.tick();
        expect(settings.keyStatus()).toBe('unreachable');
      });
      await fixture.whenStable();
      expect(q('key-required')).toBeNull();
      expect(q<HTMLTextAreaElement>('prompt')?.disabled).toBe(false);
    });
  });

  it('is free of axe violations, empty and with a transcript', async () => {
    const script = events(
      { type: 'thought', text: 'plan' },
      { type: 'tool-call', callId: 'c1', name: 'x', args: {} },
      { type: 'text-delta', text: 'Done.' },
      DONE,
    );
    const { fixture, q, root } = setup({ script });
    await fixture.whenStable();
    await expectNoA11yViolations(root);
    q<HTMLButtonElement>('chip-act1')?.click();
    await settle(fixture);
    await expectNoA11yViolations(root);
  });

  it('is free of axe violations without a key', async () => {
    const { fixture, root } = setup({ key: null });
    await fixture.whenStable();
    await expectNoA11yViolations(root);
  });
});
