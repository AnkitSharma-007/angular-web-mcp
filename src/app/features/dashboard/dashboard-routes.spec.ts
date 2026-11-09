import { DestroyRef, inject, provideEnvironmentInitializer } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter, Router, withAutoCleanupInjectors, type Route } from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';
import { ApprovalService } from '../approvals/approval-service';
import { HUMAN_APPROVAL_GATE } from '../../mcp/tooling/approval-gate';
import { expectNoA11yViolations } from '../../../testing/a11y';
import { App } from '../../app';
import { routes } from '../../app.routes';
import { PresenterActions } from '../agent-console/presenter-actions';
import { LayoutStore } from '../layout/layout-store';
import { ProposalsStore } from '../proposal/proposals-store';
import { createProposalModel } from '../../core/models/proposal';
import { DashboardUiStore } from './data/dashboard-ui-store';
import { DealsStore } from './data/deals-store';

function withDestroyProbe(onDestroy: () => void): Route[] {
  return routes.map((route) =>
    route.path === 'dashboard'
      ? {
          ...route,
          providers: [
            ...(route.providers ?? []),
            provideEnvironmentInitializer(() => inject(DestroyRef).onDestroy(onDestroy)),
          ],
        }
      : route,
  );
}

describe('dashboard route tree', () => {
  const destroyed = vi.fn();

  beforeEach(() => {
    destroyed.mockClear();
    TestBed.configureTestingModule({
      providers: [provideRouter(withDestroyProbe(destroyed), withAutoCleanupInjectors())],
    });
  });

  afterEach(() => {
    localStorage.clear();
    document.documentElement.classList.remove('dark');
  });

  it('shares one DealsStore between the dashboard and the lab', async () => {
    const harness = await RouterTestingHarness.create();
    await harness.navigateByUrl('/dashboard');
    const onDashboard = harness.routeDebugElement?.injector.get(DealsStore);
    await harness.navigateByUrl('/dashboard/lab');
    const onLab = harness.routeDebugElement?.injector.get(DealsStore);
    expect(onDashboard).toBeDefined();
    expect(onLab).toBe(onDashboard);
    expect(destroyed).not.toHaveBeenCalled();
  });

  it('keeps mutations when moving between the dashboard and the lab', async () => {
    const harness = await RouterTestingHarness.create();
    await harness.navigateByUrl('/dashboard');
    harness.routeDebugElement?.injector.get(DealsStore).applyDiscount(['D-1002'], 25);
    await harness.navigateByUrl('/dashboard/lab');
    await harness.navigateByUrl('/dashboard');
    const store = harness.routeDebugElement?.injector.get(DealsStore);
    expect(store?.entityMap()['D-1002']?.discountPct).toBe(25);
  });

  it('destroys the stores when leaving for /about and starts fresh on return', async () => {
    const harness = await RouterTestingHarness.create();
    await harness.navigateByUrl('/dashboard');
    harness.routeDebugElement?.injector.get(DealsStore).applyDiscount(['D-1002'], 25);
    await harness.navigateByUrl('/about');
    TestBed.tick();
    expect(destroyed).toHaveBeenCalledTimes(1);
    await harness.navigateByUrl('/dashboard');
    const store = harness.routeDebugElement?.injector.get(DealsStore);
    expect(store?.entityMap()['D-1002']?.discountPct).toBe(0);
  });

  it('provides the approval service as the human approval gate on the dashboard only', async () => {
    const harness = await RouterTestingHarness.create();
    await harness.navigateByUrl('/dashboard');
    const gate = harness.routeDebugElement?.injector.get(HUMAN_APPROVAL_GATE);
    expect(gate).toBe(TestBed.inject(ApprovalService));
    await harness.navigateByUrl('/about');
    expect(harness.routeDebugElement?.injector.get(HUMAN_APPROVAL_GATE, null)).toBeNull();
  });

  it('shows the agent history panel on the dashboard once something is snapshotted', async () => {
    const harness = await RouterTestingHarness.create();
    await harness.navigateByUrl('/dashboard');
    const root = harness.fixture.nativeElement as HTMLElement;
    expect(root.querySelector('app-agent-history-panel section')).toBeNull();
    harness.routeDebugElement?.injector.get(DealsStore).recordSnapshot('10% discount on 3 deals');
    await harness.fixture.whenStable();
    expect(root.querySelector('app-agent-history-panel section')?.textContent).toContain(
      '10% discount on 3 deals',
    );
  });

  it('scopes the UI store to the dashboard route', async () => {
    const harness = await RouterTestingHarness.create();
    await harness.navigateByUrl('/dashboard');
    const ui = harness.routeDebugElement?.injector.get(DashboardUiStore);
    expect(ui?.selectedDealId()).toBeNull();
    const deals = harness.routeDebugElement?.injector.get(DealsStore);
    ui?.selectDeal('D-1002');
    deals?.setFilter({ regions: ['EMEA'] });
    expect(ui?.selectedDealId()).toBeNull();
  });

  it('renders the dashboard without axe violations', async () => {
    const fixture = TestBed.createComponent(App);
    await TestBed.inject(Router).navigateByUrl('/dashboard');
    await fixture.whenStable();
    expect(fixture.nativeElement.querySelectorAll('tr[mat-row]')).toHaveLength(24);
    await expectNoA11yViolations(fixture.nativeElement);
  });

  it('toggles the agent console from the shell', async () => {
    const harness = await RouterTestingHarness.create();
    await harness.navigateByUrl('/dashboard');
    const root = harness.fixture.nativeElement as HTMLElement;
    const toggle = root.querySelector<HTMLButtonElement>('[data-testid="toggle-console"]');
    expect(root.querySelector('app-agent-console')).toBeNull();
    expect(toggle?.getAttribute('aria-pressed')).toBe('false');
    toggle?.click();
    await harness.fixture.whenStable();
    expect(root.querySelector('app-agent-console')).not.toBeNull();
    expect(toggle?.getAttribute('aria-pressed')).toBe('true');
    expect(TestBed.inject(LayoutStore).consoleOpen()).toBe(true);
  });

  it('keeps the console open on the lab page', async () => {
    const harness = await RouterTestingHarness.create();
    await harness.navigateByUrl('/dashboard');
    TestBed.inject(LayoutStore).openConsole();
    await harness.navigateByUrl('/dashboard/lab');
    expect(
      (harness.fixture.nativeElement as HTMLElement).querySelector('app-agent-console'),
    ).not.toBeNull();
  });

  it('resets the demo state when the presenter resets', async () => {
    const harness = await RouterTestingHarness.create();
    await harness.navigateByUrl('/dashboard');
    const injector = harness.routeDebugElement?.injector;
    const deals = injector?.get(DealsStore);
    const ui = injector?.get(DashboardUiStore);
    const proposals = injector?.get(ProposalsStore);
    deals?.recordSnapshot('before');
    deals?.applyDiscount(['D-1002'], 25);
    deals?.setFilter({ regions: ['EMEA'] });
    proposals?.saveDraft(createProposalModel({ dealId: 'D-1001' }));
    ui?.openProposal('D-1001');
    TestBed.inject(PresenterActions).reset();
    expect(deals?.entityMap()['D-1002']?.discountPct).toBe(0);
    expect(deals?.filter().regions).toEqual([]);
    expect(deals?.history()).toEqual([]);
    expect(proposals?.entities()).toEqual([]);
    expect(ui?.proposalOpen()).toBe(false);
  });

  it('stops resetting after leaving the dashboard', async () => {
    const harness = await RouterTestingHarness.create();
    await harness.navigateByUrl('/dashboard');
    const deals = harness.routeDebugElement?.injector.get(DealsStore);
    const reset = vi.spyOn(deals!, 'reset');
    await harness.navigateByUrl('/about');
    TestBed.tick();
    TestBed.inject(PresenterActions).reset();
    expect(reset).not.toHaveBeenCalled();
  });
});
