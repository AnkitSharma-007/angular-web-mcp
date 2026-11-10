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

  it('sizes each rect in proportion to its share of net value', async () => {
    const { root, store } = await render();
    const rects = Array.from(root.querySelectorAll('svg[role="img"] rect'));
    const widths = rects.map((rect) => Number(rect.getAttribute('width')));
    expect(widths).toEqual(store.pipelineByStage().map((stage) => stage.pct));
    expect(widths.reduce((sum, width) => sum + width, 0)).toBeCloseTo(100, 0);
    const xs = rects.map((rect) => Number(rect.getAttribute('x')));
    expect(xs[0]).toBe(0);
    expect(xs[1]).toBeCloseTo(widths[0] ?? 0, 5);
  });

  it('recomputes widths after discounts change the net value', async () => {
    const { fixture, root, store } = await render();
    const widthOf = (stage: string) =>
      Number(root.querySelector(`rect[data-stage="${stage}"]`)?.getAttribute('width'));
    const before = { negotiation: widthOf('negotiation'), won: widthOf('closed-won') };
    store.applyDiscount(['D-1004', 'D-1005'], 50);
    await fixture.whenStable();
    expect(widthOf('negotiation')).toBeLessThan(before.negotiation);
    expect(widthOf('closed-won')).toBeGreaterThan(before.won);
  });

  it('keeps the sr-only table in step with the bars', async () => {
    const { fixture, root, store } = await render();
    const rows = () =>
      Array.from(root.querySelectorAll('table.sr-only tbody tr')).map((row) =>
        Array.from(row.children).map((cell) => cell.textContent?.trim()),
      );
    expect(rows()).toHaveLength(6);
    store.applyDiscount(['D-1004'], 50);
    await fixture.whenStable();
    const negotiation = store.pipelineByStage().find((stage) => stage.key === 'negotiation');
    const row = rows().find((cells) => cells[0] === 'Negotiation');
    expect(row).toEqual([
      'Negotiation',
      String(negotiation?.count),
      expect.any(String),
      `${negotiation?.pct}%`,
    ]);
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
