import { createComponent, EnvironmentInjector } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { GlassCard, type GlassCardAccent } from './glass-card';

interface RenderOptions {
  title?: string;
  accent?: GlassCardAccent;
  content?: string;
}

function render({ title = '', accent, content = 'content' }: RenderOptions = {}) {
  const hostElement = document.createElement('app-glass-card');
  if (title) {
    hostElement.setAttribute('title', title);
  }
  const ref = createComponent(GlassCard, {
    environmentInjector: TestBed.inject(EnvironmentInjector),
    hostElement,
    projectableNodes: [[document.createTextNode(content)]],
  });
  ref.setInput('title', title);
  if (accent) {
    ref.setInput('accent', accent);
  }
  ref.changeDetectorRef.detectChanges();
  return hostElement;
}

describe('GlassCard', () => {
  it('projects its content', () => {
    expect(render({ content: 'Quarterly numbers' }).textContent).toContain('Quarterly numbers');
  });

  it('renders the title as a heading', () => {
    expect(render({ title: 'Pipeline' }).querySelector('h2')?.textContent).toBe('Pipeline');
  });

  it('omits the heading without a title', () => {
    expect(render().querySelector('h2')).toBeNull();
  });

  it('removes the native title attribute to avoid a tooltip', () => {
    expect(render({ title: 'Pipeline' }).hasAttribute('title')).toBe(false);
  });

  it('applies the glass surface', () => {
    const card = render();
    expect(card.classList.contains('glass')).toBe(true);
    expect(card.classList.contains('rounded-2xl')).toBe(true);
  });

  it.each<[GlassCardAccent, string]>([
    ['primary', 'glass-accent-primary'],
    ['warn', 'glass-accent-warn'],
    ['success', 'glass-accent-success'],
  ])('maps the %s accent to %s', (accent, expected) => {
    const card = render({ accent });
    expect(card.classList.contains(expected)).toBe(true);
    const others = ['glass-accent-primary', 'glass-accent-warn', 'glass-accent-success'].filter(
      (name) => name !== expected,
    );
    others.forEach((name) => expect(card.classList.contains(name)).toBe(false));
  });

  it('defaults to the primary accent', () => {
    expect(render().classList.contains('glass-accent-primary')).toBe(true);
  });
});
