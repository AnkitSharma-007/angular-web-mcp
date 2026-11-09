import { TestBed } from '@angular/core/testing';
import { expectNoA11yViolations } from '../../../testing/a11y';
import { FakeGenAI, fakeGenAiFactory } from '../../../testing/fake-genai';
import { GENAI_CLIENT_FACTORY } from '../../mcp/agent/gemini/genai-client';
import { ApiKeyDialogLauncher } from './api-key-dialog-launcher';
import { ByokBanner } from './byok-banner';
import { SettingsStore } from './settings-store';

function setup() {
  localStorage.clear();
  sessionStorage.clear();
  const open = vi.fn().mockResolvedValue(true);
  TestBed.configureTestingModule({
    providers: [
      { provide: GENAI_CLIENT_FACTORY, useValue: fakeGenAiFactory(new FakeGenAI()) },
      { provide: ApiKeyDialogLauncher, useValue: { open } },
    ],
  });
  const fixture = TestBed.createComponent(ByokBanner);
  return {
    fixture,
    open,
    store: TestBed.inject(SettingsStore),
    root: fixture.nativeElement as HTMLElement,
  };
}

describe('ByokBanner', () => {
  afterEach(() => {
    localStorage.clear();
    sessionStorage.clear();
  });

  it('explains that external agents need no key', async () => {
    const { fixture, root } = setup();
    await fixture.whenStable();
    expect(root.querySelector('[data-testid="byok-banner"]')?.textContent).toContain(
      'without a key',
    );
  });

  it('opens the key dialog', async () => {
    const { fixture, root, open } = setup();
    await fixture.whenStable();
    root.querySelector<HTMLButtonElement>('[data-testid="add-key"]')?.click();
    expect(open).toHaveBeenCalledOnce();
  });

  it('disappears once a key is saved', async () => {
    const { fixture, root, store } = setup();
    await fixture.whenStable();
    store.saveKey('AIza-test-key-0001', false);
    await fixture.whenStable();
    expect(root.querySelector('[data-testid="byok-banner"]')).toBeNull();
  });

  it('is free of axe violations', async () => {
    const { fixture, root } = setup();
    await fixture.whenStable();
    await expectNoA11yViolations(root);
  });
});
