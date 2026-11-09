import { TestBed } from '@angular/core/testing';
import { DealsStore } from '../data/deals-store';
import { MetricsStrip } from './metrics-strip';

async function render() {
  TestBed.configureTestingModule({ providers: [DealsStore] });
  const fixture = TestBed.createComponent(MetricsStrip);
  await fixture.whenStable();
  const root = fixture.nativeElement as HTMLElement;
  const tiles = () =>
    Array.from(root.querySelectorAll('app-stat-tile')).map((tile) =>
      Array.from(tile.querySelectorAll('p')).map((p) => p.textContent?.trim()),
    );
  return { fixture, store: TestBed.inject(DealsStore), tiles };
}

describe('MetricsStrip', () => {
  it('renders five KPI tiles from the store', async () => {
    const { store, tiles } = await render();
    const rendered = tiles();
    expect(rendered.map((tile) => tile[0])).toEqual([
      'Open pipeline',
      'Weighted forecast',
      'Closed won',
      'Win rate',
      'Stalled deals',
    ]);
    expect(rendered[3]?.[1]).toBe(`${store.kpis().winRate}%`);
    expect(rendered[4]?.[1]).toBe(String(store.kpis().stalledCount));
  });

  it('updates a tile after a mutation', async () => {
    const { fixture, store, tiles } = await render();
    const before = tiles()[0]?.[1];
    store.applyDiscount(['D-1002'], 40);
    await fixture.whenStable();
    expect(tiles()[0]?.[1]).not.toBe(before);
  });
});
