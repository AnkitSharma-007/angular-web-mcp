import { TestBed } from '@angular/core/testing';
import { AgentSessionStore } from '../../mcp/agent/agent-session-store';
import { LayoutStore } from '../layout/layout-store';
import { PresenterActions, isTypingTarget } from './presenter-actions';

function press(key: string, init: KeyboardEventInit = {}, target?: Element): KeyboardEvent {
  const event = new KeyboardEvent('keydown', { key, cancelable: true, bubbles: true, ...init });
  if (target) {
    Object.defineProperty(event, 'target', { value: target });
  }
  return event;
}

function setup() {
  return {
    presenter: TestBed.inject(PresenterActions),
    layout: TestBed.inject(LayoutStore),
    session: TestBed.inject(AgentSessionStore),
  };
}

describe('PresenterActions', () => {
  it('fills a chip prompt with its model and opens the console', () => {
    const { presenter, layout } = setup();
    expect(presenter.fillChip('2')).toBe(true);
    expect(presenter.draft()).toMatchObject({
      text: expect.stringContaining('EMEA deals in Negotiation'),
      model: 'gemini-3.8-flash',
    });
    expect(layout.consoleOpen()).toBe(true);
  });

  it('gives each fill a new nonce so the same chip can be filled twice', () => {
    const { presenter } = setup();
    presenter.fillChip('1');
    const first = presenter.draft();
    presenter.fillChip('1');
    expect(presenter.draft()).not.toBe(first);
    expect(presenter.draft()?.nonce).toBe((first?.nonce ?? 0) + 1);
  });

  it('ignores a key that is not a chip', () => {
    const { presenter, layout } = setup();
    expect(presenter.fillChip('9')).toBe(false);
    expect(presenter.draft()).toBeNull();
    expect(layout.consoleOpen()).toBe(false);
  });

  it('toggles the inspector with the backtick key', () => {
    const { presenter, layout } = setup();
    const event = press('`');
    expect(presenter.handleKey(event)).toBe(true);
    expect(event.defaultPrevented).toBe(true);
    expect(layout.inspectorOpen()).toBe(true);
    presenter.handleKey(press('`'));
    expect(layout.inspectorOpen()).toBe(false);
  });

  it('fills a chip with the number keys', () => {
    const { presenter } = setup();
    expect(presenter.handleKey(press('4'))).toBe(true);
    expect(presenter.draft()?.text).toContain('Arcadia Bank');
  });

  it('resets on Shift+R: clears the session and the draft and runs the handlers', () => {
    const { presenter, session } = setup();
    const handler = vi.fn();
    presenter.registerReset(handler);
    presenter.fillChip('1');
    const clear = vi.spyOn(session, 'clear');
    expect(presenter.handleKey(press('R', { shiftKey: true }))).toBe(true);
    expect(clear).toHaveBeenCalledOnce();
    expect(handler).toHaveBeenCalledOnce();
    expect(presenter.draft()).toBeNull();
  });

  it('stops calling a reset handler once it is unregistered', () => {
    const { presenter } = setup();
    const handler = vi.fn();
    const unregister = presenter.registerReset(handler);
    unregister();
    presenter.reset();
    expect(handler).not.toHaveBeenCalled();
  });

  it('does not treat a plain r or a shifted digit as a hotkey', () => {
    const { presenter } = setup();
    expect(presenter.handleKey(press('r'))).toBe(false);
    expect(presenter.handleKey(press('!', { shiftKey: true }))).toBe(false);
    expect(presenter.handleKey(press('1', { shiftKey: true }))).toBe(false);
    expect(presenter.draft()).toBeNull();
  });

  it('leaves unrelated keys alone', () => {
    const { presenter } = setup();
    const event = press('a');
    expect(presenter.handleKey(event)).toBe(false);
    expect(event.defaultPrevented).toBe(false);
  });

  it.each(['ctrlKey', 'metaKey', 'altKey'] as const)('ignores %s combinations', (modifier) => {
    const { presenter, layout } = setup();
    expect(presenter.handleKey(press('`', { [modifier]: true }))).toBe(false);
    expect(layout.inspectorOpen()).toBe(false);
  });

  it('ignores an event that was already handled', () => {
    const { presenter, layout } = setup();
    const event = press('`');
    event.preventDefault();
    expect(presenter.handleKey(event)).toBe(false);
    expect(layout.inspectorOpen()).toBe(false);
  });

  describe('while typing', () => {
    it.each(['input', 'textarea', 'select'])('ignores keys inside a %s', (tag) => {
      const { presenter, layout } = setup();
      const field = document.createElement(tag);
      expect(presenter.handleKey(press('`', {}, field))).toBe(false);
      expect(presenter.handleKey(press('1', {}, field))).toBe(false);
      expect(layout.inspectorOpen()).toBe(false);
      expect(presenter.draft()).toBeNull();
    });

    it('ignores keys inside editable content', () => {
      const { presenter } = setup();
      const host = document.createElement('div');
      host.setAttribute('contenteditable', 'true');
      const inner = document.createElement('span');
      host.append(inner);
      expect(presenter.handleKey(press('2', {}, inner))).toBe(false);
    });

    it('still handles keys on ordinary elements', () => {
      const { presenter } = setup();
      expect(presenter.handleKey(press('2', {}, document.createElement('button')))).toBe(true);
    });
  });
});

describe('isTypingTarget', () => {
  it('is false for a missing or non-element target', () => {
    expect(isTypingTarget(null)).toBe(false);
    expect(isTypingTarget(window)).toBe(false);
  });

  it('is false for contenteditable="false"', () => {
    const element = document.createElement('div');
    element.setAttribute('contenteditable', 'false');
    expect(isTypingTarget(element)).toBe(false);
  });
});
