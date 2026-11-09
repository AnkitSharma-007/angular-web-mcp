import { TestBed } from '@angular/core/testing';
import { provideRouter, Router } from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';
import { routes } from './app.routes';

describe('routes', () => {
  beforeEach(() => TestBed.configureTestingModule({ providers: [provideRouter(routes)] }));

  async function navigate(url: string) {
    const harness = await RouterTestingHarness.create();
    await harness.navigateByUrl(url);
    return { harness, router: TestBed.inject(Router) };
  }

  it('redirects the root to the dashboard', async () => {
    const { router } = await navigate('/');
    expect(router.url).toBe('/dashboard');
  });

  it('renders the deals table on the dashboard', async () => {
    const { harness } = await navigate('/dashboard');
    expect(harness.routeNativeElement?.querySelectorAll('tr[mat-row]')).toHaveLength(24);
  });

  it('renders the lab placeholder as a child route', async () => {
    const { harness } = await navigate('/dashboard/lab');
    expect(harness.routeNativeElement?.textContent).toContain('Lab');
  });

  it('renders the about page', async () => {
    const { harness } = await navigate('/about');
    expect(harness.routeNativeElement?.textContent).toContain('About Angular Web MCP');
  });

  it('redirects unknown urls to the dashboard', async () => {
    const { router } = await navigate('/nope');
    expect(router.url).toBe('/dashboard');
  });
});
