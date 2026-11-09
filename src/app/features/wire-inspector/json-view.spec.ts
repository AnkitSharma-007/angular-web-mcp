import { TestBed } from '@angular/core/testing';
import { expectNoA11yViolations } from '../../../testing/a11y';
import { JsonView, jsonChildren, jsonKind } from './json-view';

async function render(value: unknown, inputs: { name?: string; initialDepth?: number } = {}) {
  const fixture = TestBed.createComponent(JsonView);
  fixture.componentRef.setInput('value', value);
  if (inputs.name !== undefined) {
    fixture.componentRef.setInput('name', inputs.name);
  }
  if (inputs.initialDepth !== undefined) {
    fixture.componentRef.setInput('initialDepth', inputs.initialDepth);
  }
  await fixture.whenStable();
  const root = fixture.nativeElement as HTMLElement;
  const toggles = () => [
    ...root.querySelectorAll<HTMLButtonElement>('[data-testid="json-toggle"]'),
  ];
  const leaves = () =>
    [...root.querySelectorAll('[data-testid="json-leaf"]')].map((n) => n.textContent?.trim());
  return { fixture, root, toggles, leaves };
}

describe('jsonKind', () => {
  it('classifies values', () => {
    expect(jsonKind(null)).toBe('null');
    expect(jsonKind(undefined)).toBe('null');
    expect(jsonKind([])).toBe('array');
    expect(jsonKind('a')).toBe('string');
    expect(jsonKind(1)).toBe('number');
    expect(jsonKind(false)).toBe('boolean');
    expect(jsonKind({})).toBe('object');
  });
});

describe('jsonChildren', () => {
  it('indexes arrays and keys objects', () => {
    expect(jsonChildren(['a', 'b'])).toEqual([
      { key: '0', value: 'a' },
      { key: '1', value: 'b' },
    ]);
    expect(jsonChildren({ a: 1 })).toEqual([{ key: 'a', value: 1 }]);
    expect(jsonChildren('text')).toEqual([]);
  });
});

describe('JsonView', () => {
  it('renders primitives as leaves', async () => {
    const strings = await render('hello', { name: 'greeting' });
    expect(strings.leaves()).toEqual(['greeting:"hello"']);
    TestBed.resetTestingModule();
    const missing = await render(null);
    expect(missing.leaves()).toEqual(['null']);
    TestBed.resetTestingModule();
    const numbers = await render(42);
    expect(numbers.leaves()).toEqual(['42']);
  });

  it('shows the kind of each leaf', async () => {
    const { root } = await render({ a: 'x', b: 2, c: true, d: null });
    const kinds = [...root.querySelectorAll('[data-kind]')].map((n) => n.getAttribute('data-kind'));
    expect(kinds).toEqual(['string', 'number', 'boolean', 'null']);
  });

  it('shows empty containers as leaves', async () => {
    const { leaves, toggles } = await render({ list: [], map: {} });
    expect(toggles()).toHaveLength(1);
    expect(leaves()).toEqual(['list:[]', 'map:{}']);
  });

  it('expands the first levels and collapses the rest', async () => {
    const { toggles, leaves } = await render(
      { outer: { inner: { deep: 1 } } },
      { initialDepth: 2 },
    );
    expect(toggles().map((t) => t.getAttribute('aria-expanded'))).toEqual([
      'true',
      'true',
      'false',
    ]);
    expect(leaves()).toEqual([]);
  });

  it('collapses and expands a node', async () => {
    const { fixture, toggles, leaves } = await render({ a: 1, b: 2 });
    expect(leaves()).toEqual(['a:1', 'b:2']);
    toggles()[0]?.click();
    await fixture.whenStable();
    expect(toggles()[0]?.getAttribute('aria-expanded')).toBe('false');
    expect(leaves()).toEqual([]);
    toggles()[0]?.click();
    await fixture.whenStable();
    expect(toggles()[0]?.getAttribute('aria-expanded')).toBe('true');
    expect(leaves()).toEqual(['a:1', 'b:2']);
  });

  it('summarises a collapsed array by its length', async () => {
    const { fixture, toggles } = await render([1, 2, 3], { name: 'items' });
    toggles()[0]?.click();
    await fixture.whenStable();
    expect(toggles()[0]?.textContent).toContain('items:');
    expect(toggles()[0]?.textContent).toContain('[3]');
  });

  it('is free of axe violations', async () => {
    const { root } = await render({ request: { method: 'tools/call', params: { name: 'x' } } });
    await expectNoA11yViolations(root);
  });
});
