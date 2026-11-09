import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { expectNoA11yViolations } from '../testing/a11y';
import { App } from './app';
import { appConfig } from './app.config';
import { routes } from './app.routes';
import { PresenterActions } from './features/agent-console/presenter-actions';
import { LayoutStore } from './features/layout/layout-store';
import { REGISTRY_KIND } from './mcp/registry/registry-kind';

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

  async function render() {
    const fixture = TestBed.createComponent(App);
    await fixture.whenStable();
    return { fixture, root: fixture.nativeElement as HTMLElement };
  }

  it('renders its title', async () => {
    const { root } = await render();
    expect(root.querySelector('h1')?.textContent).toContain('Angular Web MCP');
  });

  it('runs zoneless', () => {
    expect((globalThis as { Zone?: unknown }).Zone).toBeUndefined();
  });

  it('hosts the router outlet', async () => {
    const { root } = await render();
    expect(root.querySelector('router-outlet')).not.toBeNull();
  });

  it('blocks network access in unit tests', () => {
    expect(() => fetch('/api')).toThrow('Unexpected network call');
  });

  it('configures providers for the application', () => {
    expect(appConfig.providers.length).toBeGreaterThan(0);
  });

  it('renders a glass toolbar with the theme toggle', async () => {
    const { root } = await render();
    expect(root.querySelector('mat-toolbar')?.classList.contains('glass')).toBe(true);
    expect(root.querySelector('button[aria-label^="Switch to"]')?.getAttribute('aria-label')).toBe(
      'Switch to dark theme',
    );
  });

  it('toggles the theme from the toolbar', async () => {
    const { fixture, root } = await render();
    const button = root.querySelector<HTMLButtonElement>('button[aria-label^="Switch to"]');
    button?.click();
    await fixture.whenStable();
    expect(document.documentElement.classList.contains('dark')).toBe(true);
    expect(button?.getAttribute('aria-label')).toBe('Switch to light theme');
    expect(localStorage.getItem('awm.theme')).toBe('dark');
  });

  it('shows the registry kind chip', async () => {
    TestBed.overrideProvider(REGISTRY_KIND, { useValue: 'polyfill' });
    const { root } = await render();
    const chip = root.querySelector('[data-testid="registry-chip"]');
    expect(chip?.textContent?.trim()).toBe('WebMCP: polyfill');
    expect(chip?.getAttribute('data-kind')).toBe('polyfill');
  });

  it('offers the key dialog from the toolbar', async () => {
    const { root } = await render();
    const button = root.querySelector('[data-testid="open-key-dialog"]');
    expect(button?.getAttribute('aria-label')).toBe('Add Gemini API key');
  });

  it('is free of axe violations', async () => {
    const { root } = await render();
    await expectNoA11yViolations(root);
  });

  it('forwards window key presses to the presenter hotkeys', async () => {
    await render();
    const handleKey = vi.spyOn(TestBed.inject(PresenterActions), 'handleKey');
    window.dispatchEvent(new KeyboardEvent('keydown', { key: '`', cancelable: true }));
    expect(handleKey).toHaveBeenCalledOnce();
    expect(TestBed.inject(LayoutStore).inspectorOpen()).toBe(true);
  });

  it('opens the console and fills the prompt when a chip hotkey is pressed', async () => {
    await render();
    window.dispatchEvent(new KeyboardEvent('keydown', { key: '1', cancelable: true }));
    expect(TestBed.inject(LayoutStore).consoleOpen()).toBe(true);
    expect(TestBed.inject(PresenterActions).draft()?.text).toContain('pipeline summary');
  });
  describe('wire inspector', () => {
    const inspector = (root: HTMLElement) => root.querySelector('app-wire-inspector');

    it('keeps the inspector out of the page until it is opened', async () => {
      const { root } = await render();
      expect(inspector(root)).toBeNull();
      expect(
        root.querySelector('[data-testid="toggle-inspector"]')?.getAttribute('aria-pressed'),
      ).toBe('false');
    });

    it('loads the drawer when the toolbar button is pressed', async () => {
      const { fixture, root } = await render();
      root.querySelector<HTMLButtonElement>('[data-testid="toggle-inspector"]')?.click();
      await vi.waitFor(() => {
        fixture.detectChanges();
        expect(inspector(root)).not.toBeNull();
      });
      expect(
        root.querySelector('[data-testid="toggle-inspector"]')?.getAttribute('aria-pressed'),
      ).toBe('true');
      expect(root.querySelector('main')?.style.paddingBottom).toBe('48vh');
    });

    it('loads the drawer when the hotkey opens it and removes it when it closes', async () => {
      const { fixture, root } = await render();
      const layout = TestBed.inject(LayoutStore);
      window.dispatchEvent(new KeyboardEvent('keydown', { key: '`', cancelable: true }));
      await vi.waitFor(() => {
        fixture.detectChanges();
        expect(inspector(root)).not.toBeNull();
      });
      layout.toggleInspector();
      await fixture.whenStable();
      expect(inspector(root)).toBeNull();
      expect(root.querySelector('main')?.style.paddingBottom).toBe('');
    });
  });
});
