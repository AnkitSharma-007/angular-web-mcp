import { TestbedHarnessEnvironment } from '@angular/cdk/testing/testbed';
import { TestBed } from '@angular/core/testing';
import { MatButtonHarness } from '@angular/material/button/testing';
import { MatDialog } from '@angular/material/dialog';
import { MatInputHarness } from '@angular/material/input/testing';
import { FakeGenAI, fakeGenAiFactory } from '../../../testing/fake-genai';
import { GENAI_CLIENT_FACTORY } from '../../mcp/agent/gemini/genai-client';
import { GlassCard } from '../../shared/ui/glass-card/glass-card';
import { ApiKeyDialogLauncher } from './api-key-dialog-launcher';

describe('ApiKeyDialogLauncher', () => {
  beforeEach(() => {
    localStorage.clear();
    sessionStorage.clear();
    TestBed.configureTestingModule({
      providers: [{ provide: GENAI_CLIENT_FACTORY, useValue: fakeGenAiFactory(new FakeGenAI()) }],
    });
  });

  afterEach(() => {
    TestBed.inject(MatDialog).closeAll();
    localStorage.clear();
    sessionStorage.clear();
  });

  async function openAndPress(label: string, key?: string) {
    const host = TestBed.createComponent(GlassCard);
    const result = TestBed.inject(ApiKeyDialogLauncher).open();
    const loader = TestbedHarnessEnvironment.documentRootLoader(host);
    await vi.waitFor(async () =>
      expect(await loader.getAllHarnesses(MatInputHarness)).toHaveLength(1),
    );
    if (key) {
      await (await loader.getHarness(MatInputHarness)).setValue(key);
    }
    await (await loader.getHarness(MatButtonHarness.with({ text: label }))).click();
    return result;
  }

  it('resolves true when a key is saved', async () => {
    expect(await openAndPress('Save', 'AIza-test-key-0001')).toBe(true);
  });

  it('resolves false when cancelled', async () => {
    expect(await openAndPress('Cancel')).toBe(false);
  });
});
