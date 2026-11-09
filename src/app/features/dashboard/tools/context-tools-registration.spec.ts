import { TestBed } from '@angular/core/testing';
import { provideRouter, withAutoCleanupInjectors } from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';
import { routes } from '../../../app.routes';
import { useFakeModelContext } from '../../../../testing/test-providers';

const NAMES = [
  'applyBatchDiscount',
  'getDealDetails',
  'getPipelineSummary',
  'searchDeals',
  'setDealFilter',
  'updateDealStages',
];

describe('dashboard tools route-scoped registration', () => {
  const registry = useFakeModelContext();

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [provideRouter(routes, withAutoCleanupInjectors())],
    });
  });

  afterEach(() => {
    localStorage.clear();
    document.documentElement.classList.remove('dark');
  });

  it('exposes the six dashboard tools on /dashboard and none on /about', async () => {
    const harness = await RouterTestingHarness.create();
    expect(registry.current.toolNames()).toEqual([]);

    await harness.navigateByUrl('/dashboard');
    expect(registry.current.toolNames()).toEqual(NAMES);

    await harness.navigateByUrl('/about');
    TestBed.tick();
    expect(registry.current.toolNames()).toEqual([]);

    await harness.navigateByUrl('/dashboard');
    expect(registry.current.toolNames()).toEqual(NAMES);
  });

  it('keeps the tools while moving to the lab child route', async () => {
    const harness = await RouterTestingHarness.create();
    await harness.navigateByUrl('/dashboard');
    await harness.navigateByUrl('/dashboard/lab');
    TestBed.tick();
    expect(registry.current.toolNames()).toEqual(NAMES);
  });

  it('fires toolchange when tools appear and disappear', async () => {
    const listener = vi.fn();
    registry.current.addEventListener('toolchange', listener);
    const harness = await RouterTestingHarness.create();
    await harness.navigateByUrl('/dashboard');
    expect(listener).toHaveBeenCalledTimes(NAMES.length);
    await harness.navigateByUrl('/about');
    TestBed.tick();
    expect(listener).toHaveBeenCalledTimes(NAMES.length * 2);
  });

  it('executes through the registry against the route store', async () => {
    const harness = await RouterTestingHarness.create();
    await harness.navigateByUrl('/dashboard');
    const result = (await registry.current.executeTool('searchDeals', { limit: 1 })) as {
      content: { text: string }[];
    };
    expect(JSON.parse(result.content[0]?.text ?? '{}')).toMatchObject({ total: 24 });
  });
});
