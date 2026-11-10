import { TestbedHarnessEnvironment } from '@angular/cdk/testing/testbed';
import { TestBed } from '@angular/core/testing';
import { MatButtonHarness } from '@angular/material/button/testing';
import { MatDialog } from '@angular/material/dialog';
import { MatDialogHarness } from '@angular/material/dialog/testing';
import { MatInputHarness } from '@angular/material/input/testing';
import { ListboxHarness } from '@angular/aria/listbox/testing';
import { expectNoA11yViolations } from '../../../testing/a11y';
import { FakeGenAI, fakeGenAiFactory } from '../../../testing/fake-genai';
import { GENAI_CLIENT_FACTORY } from '../../mcp/agent/gemini/genai-client';
import { GlassCard } from '../../shared/ui/glass-card/glass-card';
import { ApiKeyDialog } from './api-key-dialog';
import { API_KEY_STORAGE_KEY, SettingsStore } from './settings-store';

const KEY = 'AIza-test-key-0001';

async function open() {
  TestBed.configureTestingModule({
    providers: [{ provide: GENAI_CLIENT_FACTORY, useValue: fakeGenAiFactory(new FakeGenAI()) }],
  });
  const host = TestBed.createComponent(GlassCard);
  const closed = vi.fn();
  TestBed.inject(MatDialog)
    .open<ApiKeyDialog, undefined, boolean>(ApiKeyDialog)
    .afterClosed()
    .subscribe(closed);
  const loader = TestbedHarnessEnvironment.documentRootLoader(host);
  const dialog = await loader.getHarness(MatDialogHarness);
  return { loader, dialog, closed, store: TestBed.inject(SettingsStore) };
}

describe('ApiKeyDialog', () => {
  beforeEach(() => {
    localStorage.clear();
    sessionStorage.clear();
  });

  afterEach(() => {
    TestBed.inject(MatDialog).closeAll();
    localStorage.clear();
    sessionStorage.clear();
  });

  it('masks the key and turns autocomplete off', async () => {
    await open();
    const input = document.querySelector<HTMLInputElement>('[data-testid="api-key"]')!;
    expect(input.type).toBe('password');
    expect(input.getAttribute('autocomplete')).toBe('off');
  });

  it('lays the content out in its own flex wrapper without negative margins', async () => {
    await open();
    const content = document.querySelector('mat-dialog-content');
    const layout = content?.querySelector('[data-testid="dialog-layout"]');
    expect(layout?.className).toContain('flex-col');
    expect(content?.className).not.toContain('flex');
    expect(content?.innerHTML).not.toMatch(/-mt-/);
  });

  it('links to Google AI Studio', async () => {
    await open();
    const link = document.querySelector<HTMLAnchorElement>(
      'a[href="https://aistudio.google.com/apikey"]',
    );
    expect(link?.rel).toContain('noopener');
  });

  it('blocks an empty key and says why', async () => {
    const { loader, closed, store } = await open();
    await (await loader.getHarness(MatButtonHarness.with({ text: 'Save' }))).click();
    expect(closed).not.toHaveBeenCalled();
    expect(document.querySelector('[role="alert"]')?.textContent).toContain(
      'Enter your Gemini API key',
    );
    expect(store.hasKey()).toBe(false);
  });

  it('blocks a whitespace-only key', async () => {
    const { loader, closed } = await open();
    await (await loader.getHarness(MatInputHarness)).setValue('   ');
    await (await loader.getHarness(MatButtonHarness.with({ text: 'Save' }))).click();
    expect(closed).not.toHaveBeenCalled();
  });

  it('saves the key for the session by default and closes', async () => {
    const { loader, closed, store } = await open();
    await (await loader.getHarness(MatInputHarness)).setValue(KEY);
    await (await loader.getHarness(MatButtonHarness.with({ text: 'Save' }))).click();
    await vi.waitFor(() => expect(closed).toHaveBeenCalledExactlyOnceWith(true));
    expect(store.apiKey()).toBe(KEY);
    expect(sessionStorage.getItem(API_KEY_STORAGE_KEY)).toBe(KEY);
    expect(localStorage.getItem(API_KEY_STORAGE_KEY)).toBeNull();
  });

  it('remembers the key on the device when the box is ticked', async () => {
    const { loader, closed } = await open();
    await (await loader.getHarness(MatInputHarness)).setValue(KEY);
    const remember = document.querySelector<HTMLInputElement>('[data-testid="remember"]')!;
    remember.click();
    await (await loader.getHarness(MatButtonHarness.with({ text: 'Save' }))).click();
    await vi.waitFor(() => expect(closed).toHaveBeenCalled());
    expect(localStorage.getItem(API_KEY_STORAGE_KEY)).toBe(KEY);
  });

  it('saves the selected model', async () => {
    const { loader, closed, store } = await open();
    await (await loader.getHarness(MatInputHarness)).setValue(KEY);
    const listbox = await loader.getHarness(ListboxHarness);
    const [sprinter] = await listbox.getOptions({ text: /Sprinter/ });
    await sprinter?.click();
    await (await loader.getHarness(MatButtonHarness.with({ text: 'Save' }))).click();
    await vi.waitFor(() => expect(closed).toHaveBeenCalled());
    expect(store.model()).toBe('gemini-3.5-flash-lite');
  });

  it('shows the paid-tier badge on Argon', async () => {
    await open();
    expect(
      document.querySelector('[data-testid="model-gemini-4-argon"] [data-testid="paid-badge"]')
        ?.textContent,
    ).toContain('Paid tier');
  });

  it('does not change anything on cancel', async () => {
    const { loader, closed, store } = await open();
    await (await loader.getHarness(MatInputHarness)).setValue(KEY);
    await (await loader.getHarness(MatButtonHarness.with({ text: 'Cancel' }))).click();
    await vi.waitFor(() => expect(closed).toHaveBeenCalledExactlyOnceWith(false));
    expect(store.hasKey()).toBe(false);
  });

  it('forgets a saved key', async () => {
    const { loader, store } = await open();
    store.saveKey(KEY, true);
    await (await loader.getHarness(MatButtonHarness.with({ text: 'Forget key' }))).click();
    expect(store.hasKey()).toBe(false);
    expect(localStorage.getItem(API_KEY_STORAGE_KEY)).toBeNull();
    expect(await (await loader.getHarness(MatInputHarness)).getValue()).toBe('');
  });

  it('offers no Forget button when there is no key', async () => {
    const { loader } = await open();
    expect(
      await loader.getAllHarnesses(MatButtonHarness.with({ text: 'Forget key' })),
    ).toHaveLength(0);
  });

  it('is free of axe violations', async () => {
    const { dialog } = await open();
    expect(await dialog.getText()).toContain('Gemini API key and model');
    await expectNoA11yViolations(document.querySelector('app-api-key-dialog')!);
  });
});
