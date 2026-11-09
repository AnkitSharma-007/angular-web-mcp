import { DestroyRef, inject, provideEnvironmentInitializer } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter, Router, withAutoCleanupInjectors, type Route } from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';
import { expectNoA11yViolations } from '../../../testing/a11y';
import { App } from '../../app';
import { routes } from '../../app.routes';
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
});
