import { TestBed } from '@angular/core/testing';
import { setAllEntities } from '@ngrx/signals/entities';
import { patchState } from '@ngrx/signals';
import { unprotected } from '@ngrx/signals/testing';
import type { Deal } from '../../../core/models/deal';
import { DealsStore } from '../data/deals-store';
import { PipelineChart } from './pipeline-chart';

async function render() {
  TestBed.configureTestingModule({ providers: [DealsStore] });
  const fixture = TestBed.createComponent(PipelineChart);
  await fixture.whenStable();
  return { fixture, root: fixture.nativeElement as HTMLElement, store: TestBed.inject(DealsStore) };
}

describe('PipelineChart', () => {
  it('draws one rect per stage', async () => {
    const { root } = await render();
    expect(root.querySelectorAll('svg[role="img"] rect')).toHaveLength(6);
  });

  it('describes the chart for assistive technology', async () => {
    const { root } = await render();
    expect(root.querySelector('svg[role="img"]')?.getAttribute('aria-label')).toContain(
      'Pipeline distribution by stage: Prospecting',
    );
  });

  it('lists every region', async () => {
    const { root } = await render();
    const regions = Array.from(root.querySelectorAll('ul[aria-label="Net value by region"] li'));
    expect(regions.map((li) => li.textContent?.trim().slice(0, 4))).toEqual([
      'APAC',
      'EMEA',
      'NA $',
      'LATA',
    ]);
  });

  it('shows an empty state without NaN when there is no pipeline value', async () => {
    const { fixture, root, store } = await render();
    patchState(unprotected(store), setAllEntities<Deal>([]));
    await fixture.whenStable();
    expect(root.querySelector('svg[role="img"]')).toBeNull();
    expect(root.textContent).toContain('No pipeline value to show.');
    expect(root.innerHTML).not.toContain('NaN');
  });
});
