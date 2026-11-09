import type { HarnessLoader } from '@angular/cdk/testing';
import { TestbedHarnessEnvironment } from '@angular/cdk/testing/testbed';
import { TestBed } from '@angular/core/testing';
import { MatChipSetHarness } from '@angular/material/chips/testing';
import { MatSortHarness } from '@angular/material/sort/testing';
import { MatTableHarness } from '@angular/material/table/testing';
import { DashboardUiStore } from '../data/dashboard-ui-store';
import { DealsStore } from '../data/deals-store';
import { DealsTable, FLASH_DURATION_MS, SEARCH_DEBOUNCE_MS } from './deals-table';

async function setup(fakeTimers = false) {
  if (fakeTimers) {
    vi.useFakeTimers();
  }
  TestBed.configureTestingModule({ providers: [DealsStore, DashboardUiStore] });
  const fixture = TestBed.createComponent(DealsTable);
  if (fakeTimers) {
    fixture.detectChanges();
    await vi.advanceTimersByTimeAsync(SEARCH_DEBOUNCE_MS);
  }
  await fixture.whenStable();
  const loader: HarnessLoader = TestbedHarnessEnvironment.loader(fixture);
  return {
    fixture,
    loader,
    root: fixture.nativeElement as HTMLElement,
    store: TestBed.inject(DealsStore),
    ui: TestBed.inject(DashboardUiStore),
    table: () => loader.getHarness(MatTableHarness),
  };
}

describe('DealsTable', () => {
  afterEach(() => vi.useRealTimers());

  it('renders all 24 seeded deals', async () => {
    const { table, root } = await setup();
    expect(await (await table()).getRows()).toHaveLength(24);
    expect(root.textContent).toContain('Showing 24 of 24 deals');
  });

  it('shows only filtered deals and a chip per active filter', async () => {
    const { fixture, loader, store, table } = await setup();
    store.setFilter({ regions: ['EMEA'], stages: ['negotiation'] });
    await fixture.whenStable();
    const rows = await (await table()).getRows();
    expect(rows.length).toBeGreaterThan(0);
    expect(rows.length).toBeLessThan(24);
    const chips = await (await loader.getHarness(MatChipSetHarness)).getChips();
    expect(await Promise.all(chips.map((chip) => chip.getText()))).toEqual(
      expect.arrayContaining([
        expect.stringContaining('Negotiation'),
        expect.stringContaining('EMEA'),
      ]),
    );
  });

  it('shows exactly the EMEA deals under an EMEA filter', async () => {
    const { fixture, store, table } = await setup();
    store.setFilter({ regions: ['EMEA'] });
    await fixture.whenStable();
    const emea = store.entities().filter((deal) => deal.region === 'EMEA').length;
    expect(await (await table()).getRows()).toHaveLength(emea);
  });

  it('removes a filter when its chip is removed', async () => {
    const { fixture, loader, store } = await setup();
    store.setFilter({ regions: ['EMEA'] });
    await fixture.whenStable();
    const [chip] = await (await loader.getHarness(MatChipSetHarness)).getChips();
    await (await chip?.getRemoveButton())?.click();
    expect(store.filter().regions).toEqual([]);
  });

  it('sorts by net value when the header is clicked', async () => {
    const { loader, store, table } = await setup();
    const header = await loader.getHarness(MatSortHarness);
    const [netValueHeader] = await header.getSortHeaders({ label: 'Net value' });
    await netValueHeader?.click();
    await netValueHeader?.click();
    const first = (await (await table()).getRows())[0];
    const expected = store
      .entities()
      .reduce((best, deal) =>
        deal.listValue * (1 - deal.discountPct / 100) >
        best.listValue * (1 - best.discountPct / 100)
          ? deal
          : best,
      );
    expect(await first?.getCellTextByIndex()).toEqual(
      expect.arrayContaining([expect.stringContaining(expected.account)]),
    );
  });

  it('filters by search only after the debounce window', async () => {
    const { fixture, root, store, table } = await setup(true);
    const input = root.querySelector<HTMLInputElement>('input[type="search"]');
    input!.value = 'arcadia';
    input!.dispatchEvent(new Event('input'));
    await vi.advanceTimersByTimeAsync(SEARCH_DEBOUNCE_MS - 1);
    expect(store.filter().query).toBe('');
    await vi.advanceTimersByTimeAsync(2);
    await fixture.whenStable();
    expect(store.filter().query).toBe('arcadia');
    expect(await (await table()).getRows()).toHaveLength(1);
  });

  it('mirrors a query set elsewhere into the search box', async () => {
    const { fixture, root, store } = await setup();
    store.setFilter({ query: 'konkan' });
    await fixture.whenStable();
    expect(root.querySelector<HTMLInputElement>('input[type="search"]')?.value).toBe('konkan');
  });

  it('selects a deal on row click', async () => {
    const { fixture, root, ui } = await setup();
    root.querySelector<HTMLElement>('tr[data-deal-id="D-1002"]')?.click();
    await fixture.whenStable();
    expect(ui.selectedDealId()).toBe('D-1002');
    expect(root.querySelector('tr[data-deal-id="D-1002"]')?.getAttribute('aria-current')).toBe(
      'true',
    );
  });

  it('flashes a changed row for two seconds', async () => {
    const { fixture, root, store } = await setup(true);
    store.applyDiscount(['D-1002'], 15);
    fixture.detectChanges();
    const row = () => root.querySelector('tr[data-deal-id="D-1002"]');
    expect(row()?.classList.contains('row-flash')).toBe(true);
    expect(root.querySelector('tr[data-deal-id="D-1003"]')?.classList.contains('row-flash')).toBe(
      false,
    );
    await vi.advanceTimersByTimeAsync(FLASH_DURATION_MS);
    fixture.detectChanges();
    expect(row()?.classList.contains('row-flash')).toBe(false);
  });

  it('shows an empty state when nothing matches', async () => {
    const { fixture, root, store } = await setup();
    store.setFilter({ minValue: 1e9 });
    await fixture.whenStable();
    expect(root.textContent).toContain('No deals match the current filters.');
  });
});
