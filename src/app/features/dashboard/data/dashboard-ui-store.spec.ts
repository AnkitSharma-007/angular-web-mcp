import { TestBed } from '@angular/core/testing';
import { DashboardUiStore } from './dashboard-ui-store';
import { DealsStore } from './deals-store';

function setup() {
  TestBed.configureTestingModule({ providers: [DealsStore, DashboardUiStore] });
  return { deals: TestBed.inject(DealsStore), ui: TestBed.inject(DashboardUiStore) };
}

describe('DashboardUiStore', () => {
  it('starts with nothing selected and the proposal drawer closed', () => {
    const { ui } = setup();
    expect(ui.selectedDealId()).toBeNull();
    expect(ui.proposalOpen()).toBe(false);
  });

  it('selects and clears a deal', () => {
    const { ui } = setup();
    ui.selectDeal('D-1002');
    expect(ui.selectedDealId()).toBe('D-1002');
    ui.selectDeal(null);
    expect(ui.selectedDealId()).toBeNull();
  });

  it('keeps the selection while the deal stays visible', () => {
    const { deals, ui } = setup();
    ui.selectDeal('D-1004');
    deals.setQuery('D-1004');
    expect(ui.selectedDealId()).toBe('D-1004');
    deals.applyDiscount(['D-1004'], 10);
    expect(ui.selectedDealId()).toBe('D-1004');
  });

  it('resets the selection when the deal is filtered out', () => {
    const { deals, ui } = setup();
    ui.selectDeal('D-1002');
    deals.setQuery('D-1004');
    expect(ui.selectedDealId()).toBeNull();
  });

  it('opens and closes the proposal drawer', () => {
    const { ui } = setup();
    ui.openProposal();
    expect(ui.proposalOpen()).toBe(true);
    ui.closeProposal();
    expect(ui.proposalOpen()).toBe(false);
  });
});
