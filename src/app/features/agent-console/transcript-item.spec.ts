import { TestBed } from '@angular/core/testing';
import { expectNoA11yViolations } from '../../../testing/a11y';
import type { AgentErrorKind, AgentEvent } from '../../mcp/agent/agent-events';
import type { TranscriptEntry } from '../../mcp/agent/agent-session-store';
import { TranscriptItem, type ErrorFix } from './transcript-item';

async function render(entry: TranscriptEntry) {
  const fixture = TestBed.createComponent(TranscriptItem);
  fixture.componentRef.setInput('entry', entry);
  const fixes: ErrorFix[] = [];
  fixture.componentInstance.fix.subscribe((fix) => fixes.push(fix));
  await fixture.whenStable();
  return { fixture, fixes, root: fixture.nativeElement as HTMLElement };
}

const event = (value: AgentEvent): TranscriptEntry => ({ id: 1, kind: 'event', event: value });
const q = (root: HTMLElement, testId: string) => root.querySelector(`[data-testid="${testId}"]`);

describe('TranscriptItem', () => {
  it('renders the user prompt as text', async () => {
    const { root } = await render({ id: 1, kind: 'user', text: '<b>bold</b> prompt' });
    const bubble = q(root, 'user-message');
    expect(bubble?.textContent).toContain('<b>bold</b> prompt');
    expect(bubble?.querySelector('b')).toBeNull();
  });

  it('renders model text as text, never as HTML', async () => {
    const { root } = await render(event({ type: 'text-delta', text: '<img src=x> hello' }));
    const text = q(root, 'agent-text');
    expect(text?.textContent).toContain('<img src=x> hello');
    expect(root.querySelector('img')).toBeNull();
  });

  it('renders a thought inside a collapsed details element', async () => {
    const { root } = await render(event({ type: 'thought', text: 'Look at EMEA first' }));
    const thought = q(root, 'thought') as HTMLDetailsElement;
    expect(thought.tagName).toBe('DETAILS');
    expect(thought.open).toBe(false);
    expect(thought.textContent).toContain('Look at EMEA first');
  });

  it('renders a tool call with its arguments', async () => {
    const { root } = await render(
      event({ type: 'tool-call', callId: 'c1', name: 'searchDeals', args: { limit: 5 } }),
    );
    const card = q(root, 'tool-call');
    expect(card?.textContent).toContain('searchDeals');
    expect(card?.querySelector('pre')?.textContent).toContain('"limit": 5');
  });

  it('renders a successful tool result with its latency', async () => {
    const { root } = await render(
      event({
        type: 'tool-result',
        callId: 'c1',
        name: 'searchDeals',
        result: { total: 3 },
        ok: true,
        latencyMs: 12.4,
      }),
    );
    const card = q(root, 'tool-result');
    expect(card?.getAttribute('data-ok')).toBe('true');
    expect(card?.textContent).toContain('returned in 12 ms');
    expect(card?.querySelector('pre')?.textContent).toContain('"total": 3');
  });

  it('marks a failed tool result', async () => {
    const { root } = await render(
      event({
        type: 'tool-result',
        callId: 'c1',
        name: 'draftDealProposal',
        result: 'Form submission failed',
        ok: false,
        latencyMs: 3,
      }),
    );
    const card = q(root, 'tool-result');
    expect(card?.getAttribute('data-ok')).toBe('false');
    expect(card?.textContent).toContain('failed in 3 ms');
  });

  it('lists the tools that appeared and disappeared', async () => {
    const { root } = await render(
      event({ type: 'tools-changed', added: ['draftDealProposal'], removed: ['oldTool'] }),
    );
    const note = q(root, 'tools-changed');
    expect(note?.textContent).toContain('+ draftDealProposal');
    expect(note?.textContent).toContain('− oldTool');
  });

  it('announces the approval wait to assistive technology', async () => {
    const { root } = await render(
      event({ type: 'awaiting-approval', toolName: 'terminateContract' }),
    );
    const note = q(root, 'awaiting-approval');
    expect(note?.getAttribute('role')).toBe('status');
    expect(note?.textContent).toContain('Waiting for your approval: terminateContract');
  });

  it('summarises usage, cost and time when the run is done', async () => {
    const { root } = await render(
      event({
        type: 'done',
        usage: { input: 1000, output: 200, thinking: 300 },
        costUsd: 0.01234,
        model: 'gemini-3.8-flash',
        ms: 2500,
      }),
    );
    const done = q(root, 'done')?.textContent ?? '';
    expect(done).toContain('🛠️ gemini-3.8-flash');
    expect(done).toContain('1,500 tokens');
    expect(done).toContain('300 thinking');
    expect(done).toContain('$0.0123');
    expect(done).toContain('2.5 s');
  });

  it('shows a plain label for a model that is not in the catalog', async () => {
    const { root } = await render(
      event({
        type: 'done',
        usage: { input: 1, output: 1, thinking: 0 },
        costUsd: 0,
        model: 'custom-model',
        ms: 100,
      }),
    );
    expect(q(root, 'done')?.textContent).toContain('custom-model');
  });

  describe('error cards', () => {
    const errorEntry = (kind: AgentErrorKind) =>
      event({ type: 'error', kind, message: 'boom from the API' });

    it('offers to open the key dialog for an auth error', async () => {
      const { root, fixes } = await render(errorEntry('auth'));
      const card = q(root, 'error-card');
      expect(card?.getAttribute('role')).toBe('alert');
      expect(card?.textContent).toContain('The API key was rejected');
      expect(q(root, 'error-message')?.textContent).toContain('boom from the API');
      (q(root, 'error-fix') as HTMLButtonElement).click();
      expect(fixes).toEqual(['open-key-dialog']);
    });

    it('offers to switch model for a model-access error', async () => {
      const { root, fixes } = await render(errorEntry('model-access'));
      const button = q(root, 'error-fix') as HTMLButtonElement;
      expect(button.textContent).toContain('Switch to Operator');
      button.click();
      expect(fixes).toEqual(['use-default-model']);
    });

    it.each(['quota', 'network', 'max-steps', 'unknown'] as const)(
      'explains a %s error without a fix button',
      async (kind) => {
        const { root } = await render(errorEntry(kind));
        expect(q(root, 'error-card')?.getAttribute('data-kind')).toBe(kind);
        expect(q(root, 'error-fix')).toBeNull();
      },
    );
  });

  it('is free of axe violations for every card', async () => {
    const events: AgentEvent[] = [
      { type: 'thought', text: 'thinking' },
      { type: 'tool-call', callId: 'c', name: 'x', args: {} },
      { type: 'tool-result', callId: 'c', name: 'x', result: {}, ok: true, latencyMs: 1 },
      { type: 'awaiting-approval', toolName: 'x' },
      { type: 'error', kind: 'auth', message: 'm' },
    ];
    for (const value of events) {
      const { root } = await render(event(value));
      await expectNoA11yViolations(root);
    }
  });
});
