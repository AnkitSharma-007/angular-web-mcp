import { provideRouter } from '@angular/router';
import { TestBed } from '@angular/core/testing';
import { App } from './app';
import { appConfig } from './app.config';
import { routes } from './app.routes';

describe('App', () => {
  beforeEach(() => {
    TestBed.configureTestingModule({
      imports: [App],
      providers: [provideRouter(routes)],
    });
  });

  afterEach(() => {
    localStorage.clear();
    document.documentElement.classList.remove('dark');
  });

  it('renders its title', async () => {
    const fixture = TestBed.createComponent(App);
    await fixture.whenStable();
    const heading = (fixture.nativeElement as HTMLElement).querySelector('h1');
    expect(heading?.textContent).toContain('Angular Web MCP');
  });

  it('runs zoneless', () => {
    expect((globalThis as { Zone?: unknown }).Zone).toBeUndefined();
  });

  it('hosts the router outlet', async () => {
    const fixture = TestBed.createComponent(App);
    await fixture.whenStable();
    const root = fixture.nativeElement as HTMLElement;
    expect(root.querySelector('router-outlet')).not.toBeNull();
  });

  it('blocks network access in unit tests', () => {
    expect(() => fetch('/api')).toThrow('Unexpected network call');
  });

  it('toggles the theme from the toolbar', async () => {
    const fixture = TestBed.createComponent(App);
    await fixture.whenStable();
    const button = (fixture.nativeElement as HTMLElement).querySelector('button');
    button?.click();
    await fixture.whenStable();
    expect(document.documentElement.classList.contains('dark')).toBe(false);
    expect(button?.getAttribute('aria-label')).toBe('Switch to dark theme');
  });

  it('configures providers for the application', () => {
    expect(appConfig.providers.length).toBeGreaterThan(0);
  });
});
