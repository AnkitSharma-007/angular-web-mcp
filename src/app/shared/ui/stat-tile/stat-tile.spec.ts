import { createComponent, EnvironmentInjector } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { StatTile } from './stat-tile';

function render(inputs: Record<string, string>) {
  const hostElement = document.createElement('app-stat-tile');
  document.body.append(hostElement);
  const ref = createComponent(StatTile, {
    environmentInjector: TestBed.inject(EnvironmentInjector),
    hostElement,
  });
  for (const [name, value] of Object.entries(inputs)) {
    ref.setInput(name, value);
  }
  ref.changeDetectorRef.detectChanges();
  return hostElement;
}

describe('StatTile', () => {
  afterEach(() => document.body.replaceChildren());

  it('shows the label and value', () => {
    const tile = render({ label: 'Open pipeline', value: '$4.2M' });
    expect(tile.textContent).toContain('Open pipeline');
    expect(tile.textContent).toContain('$4.2M');
  });

  it('shows the hint only when given', () => {
    expect(render({ label: 'A', value: '1' }).querySelectorAll('p')).toHaveLength(2);
    expect(render({ label: 'A', value: '1', hint: 'note' }).querySelectorAll('p')).toHaveLength(3);
  });

  it('passes the accent to the glass card', () => {
    const tile = render({ label: 'A', value: '1', accent: 'warn' });
    expect(tile.querySelector('app-glass-card')?.classList.contains('glass-accent-warn')).toBe(
      true,
    );
  });
});
