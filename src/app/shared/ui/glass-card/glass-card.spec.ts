import { createComponent, EnvironmentInjector } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { GlassCard } from './glass-card';

function render(title: string, content: string) {
  const hostElement = document.createElement('app-glass-card');
  hostElement.setAttribute('title', title);
  const ref = createComponent(GlassCard, {
    environmentInjector: TestBed.inject(EnvironmentInjector),
    hostElement,
    projectableNodes: [[document.createTextNode(content)]],
  });
  ref.setInput('title', title);
  ref.changeDetectorRef.detectChanges();
  return hostElement;
}

describe('GlassCard', () => {
  it('renders the title and projected content', () => {
    const card = render('Pipeline', 'content');
    expect(card.querySelector('h2')?.textContent).toBe('Pipeline');
    expect(card.textContent).toContain('content');
    expect(card.classList.contains('glass-accent-primary')).toBe(true);
    expect(card.hasAttribute('title')).toBe(false);
  });
});
