import { createComponent, EnvironmentInjector } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { DEAL_STAGES, DEAL_STAGE_LABELS, type DealStage } from '../../../core/models/deal';
import { expectNoA11yViolations } from '../../../../testing/a11y';
import { StageBadge } from './stage-badge';

function render(stage: DealStage) {
  const hostElement = document.createElement('app-stage-badge');
  const landmark = document.createElement('main');
  landmark.append(hostElement);
  document.body.append(landmark);
  const ref = createComponent(StageBadge, {
    environmentInjector: TestBed.inject(EnvironmentInjector),
    hostElement,
  });
  ref.setInput('stage', stage);
  ref.changeDetectorRef.detectChanges();
  return hostElement;
}

describe('StageBadge', () => {
  afterEach(() => document.body.replaceChildren());

  it.each(DEAL_STAGES)('shows the label for %s', (stage) => {
    const badge = render(stage);
    expect(badge.textContent?.trim()).toBe(DEAL_STAGE_LABELS[stage]);
    expect(badge.dataset['stage']).toBe(stage);
  });

  it.each<[DealStage, string]>([
    ['prospecting', 'text-on-surface-variant'],
    ['qualification', 'bg-primary/10'],
    ['proposal', 'bg-primary/20'],
    ['negotiation', 'bg-primary'],
    ['closed-won', 'text-success'],
    ['closed-lost', 'text-error'],
  ])('colors %s with %s', (stage, expected) => {
    expect(render(stage).classList.contains(expected)).toBe(true);
  });

  it('keeps the pill shape on every stage', () => {
    expect(render('proposal').classList.contains('rounded-full')).toBe(true);
  });

  it('is axe-clean', async () => {
    render('negotiation');
    await expectNoA11yViolations();
  });
});
