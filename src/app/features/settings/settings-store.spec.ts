import { TestBed } from '@angular/core/testing';
import { DEFAULT_MODEL_ID } from '../../mcp/agent/gemini/gemini-models';
import { GENAI_CLIENT_FACTORY } from '../../mcp/agent/gemini/genai-client';
import { FakeApiError, FakeGenAI, fakeGenAiFactory } from '../../../testing/fake-genai';
import {
  API_KEY_STORAGE_KEY,
  KEY_CHECK_TIMEOUT_MS,
  MODEL_STORAGE_KEY,
  SettingsStore,
  toVerdict,
} from './settings-store';

const KEY = 'AIza-test-key-0001';

function setup(fake = new FakeGenAI()) {
  TestBed.configureTestingModule({
    providers: [{ provide: GENAI_CLIENT_FACTORY, useValue: fakeGenAiFactory(fake) }],
  });
  return { fake, store: TestBed.inject(SettingsStore) };
}

async function settled(store: InstanceType<typeof SettingsStore>) {
  await vi.waitFor(() => {
    TestBed.tick();
    expect(store.keyStatus()).not.toBe('checking');
  });
}

describe('SettingsStore', () => {
  beforeEach(() => {
    localStorage.clear();
    sessionStorage.clear();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    localStorage.clear();
    sessionStorage.clear();
  });

  it('starts empty with the default model', () => {
    const { store } = setup();
    expect(store.apiKey()).toBe('');
    expect(store.hasKey()).toBe(false);
    expect(store.remember()).toBe(false);
    expect(store.model()).toBe(DEFAULT_MODEL_ID);
    expect(store.keyStatus()).toBe('missing');
  });

  it('keeps the key in the session only by default', () => {
    const { store } = setup();
    store.saveKey(`  ${KEY}  `, false);
    expect(store.apiKey()).toBe(KEY);
    expect(sessionStorage.getItem(API_KEY_STORAGE_KEY)).toBe(KEY);
    expect(localStorage.getItem(API_KEY_STORAGE_KEY)).toBeNull();
  });

  it('persists the key on the device when asked to remember it', () => {
    const { store } = setup();
    store.saveKey(KEY, true);
    expect(store.remember()).toBe(true);
    expect(localStorage.getItem(API_KEY_STORAGE_KEY)).toBe(KEY);
  });

  it('drops the persisted copy when remember is switched off', () => {
    const { store } = setup();
    store.saveKey(KEY, true);
    store.saveKey(KEY, false);
    expect(localStorage.getItem(API_KEY_STORAGE_KEY)).toBeNull();
    expect(sessionStorage.getItem(API_KEY_STORAGE_KEY)).toBe(KEY);
  });

  it('treats a blank key as no key', () => {
    const { store } = setup();
    store.saveKey('   ', true);
    expect(store.hasKey()).toBe(false);
    expect(store.remember()).toBe(false);
    expect(sessionStorage.getItem(API_KEY_STORAGE_KEY)).toBeNull();
  });

  it('restores a remembered key', () => {
    localStorage.setItem(API_KEY_STORAGE_KEY, KEY);
    const { store } = setup();
    expect(store.apiKey()).toBe(KEY);
    expect(store.remember()).toBe(true);
  });

  it('restores a session key', () => {
    sessionStorage.setItem(API_KEY_STORAGE_KEY, KEY);
    const { store } = setup();
    expect(store.apiKey()).toBe(KEY);
    expect(store.remember()).toBe(false);
  });

  it('forgets the key from memory and both storages', () => {
    const { store } = setup();
    store.saveKey(KEY, true);
    store.forgetKey();
    expect(store.apiKey()).toBe('');
    expect(store.remember()).toBe(false);
    expect(localStorage.getItem(API_KEY_STORAGE_KEY)).toBeNull();
    expect(sessionStorage.getItem(API_KEY_STORAGE_KEY)).toBeNull();
  });

  it('stores and restores the chosen model, ignoring an unknown stored one', () => {
    const first = setup();
    first.store.setModel('gemini-3.5-flash-lite');
    expect(localStorage.getItem(MODEL_STORAGE_KEY)).toBe('gemini-3.5-flash-lite');
    TestBed.resetTestingModule();
    expect(setup().store.model()).toBe('gemini-3.5-flash-lite');
    TestBed.resetTestingModule();
    localStorage.setItem(MODEL_STORAGE_KEY, 'gemini-4-argon');
    expect(setup().store.model()).toBe(DEFAULT_MODEL_ID);
  });

  it('keeps working when storage throws', () => {
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('quota');
    });
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('blocked');
    });
    vi.spyOn(Storage.prototype, 'removeItem').mockImplementation(() => {
      throw new Error('blocked');
    });
    const { store } = setup();
    expect(store.apiKey()).toBe('');
    store.saveKey(KEY, true);
    store.setModel('gemini-3.5-flash-lite');
    expect(store.apiKey()).toBe(KEY);
    store.forgetKey();
    expect(store.apiKey()).toBe('');
  });

  describe('keyCheck', () => {
    it('is valid when models.list succeeds', async () => {
      const { store, fake } = setup();
      store.saveKey(KEY, false);
      expect(store.keyStatus()).toBe('checking');
      await settled(store);
      expect(store.keyStatus()).toBe('valid');
      expect(fake.listCalls).toHaveLength(1);
    });

    it('is invalid when Google rejects the key', async () => {
      const fake = new FakeGenAI();
      fake.listError = new FakeApiError(400, 'API key not valid');
      const { store } = setup(fake);
      store.saveKey(KEY, false);
      await settled(store);
      expect(store.keyStatus()).toBe('invalid');
    });

    it('is unreachable on a network failure', async () => {
      const fake = new FakeGenAI();
      fake.listError = new TypeError('Failed to fetch');
      const { store } = setup(fake);
      store.saveKey(KEY, false);
      await settled(store);
      expect(store.keyStatus()).toBe('unreachable');
    });

    it('treats a rate limit as a working key', async () => {
      const fake = new FakeGenAI();
      fake.listError = new FakeApiError(429);
      const { store } = setup(fake);
      store.saveKey(KEY, false);
      await settled(store);
      expect(store.keyStatus()).toBe('valid');
    });

    it('aborts the pending check when the key changes', async () => {
      const fake = new FakeGenAI();
      fake.listHold = new Promise(() => undefined);
      const { store } = setup(fake);
      store.saveKey(KEY, false);
      await vi.waitFor(() => {
        TestBed.tick();
        expect(fake.listCalls).toHaveLength(1);
      });
      store.saveKey('AIza-test-key-0002', false);
      await vi.waitFor(() => {
        TestBed.tick();
        expect(fake.listCalls).toHaveLength(2);
      });
      expect(fake.listCalls[0]?.abortSignal?.aborted).toBe(true);
    });

    it('reports unreachable when Gemini never answers within the deadline', async () => {
      vi.useFakeTimers();
      try {
        const fake = new FakeGenAI();
        fake.listHold = new Promise(() => undefined);
        const { store } = setup(fake);
        store.saveKey(KEY, false);
        await vi.advanceTimersByTimeAsync(0);
        TestBed.tick();
        await vi.advanceTimersByTimeAsync(KEY_CHECK_TIMEOUT_MS + 10);
        TestBed.tick();
        await vi.advanceTimersByTimeAsync(0);
        expect(store.keyStatus()).toBe('unreachable');
        expect(store.keyCheck.value()).toMatchObject({
          ok: false,
          message: expect.stringContaining('did not answer'),
        });
      } finally {
        vi.useRealTimers();
      }
    });

    it('goes back to missing after the key is forgotten', async () => {
      const { store } = setup();
      store.saveKey(KEY, false);
      await settled(store);
      store.forgetKey();
      TestBed.tick();
      expect(store.keyStatus()).toBe('missing');
    });
  });

  describe('canUseAgent', () => {
    it('is false without a key', () => {
      const { store } = setup();
      expect(store.canUseAgent()).toBe(false);
    });

    it('is true while the key is checked and once it is valid', async () => {
      const { store } = setup();
      store.saveKey(KEY, false);
      expect(store.keyStatus()).toBe('checking');
      expect(store.canUseAgent()).toBe(true);
      await settled(store);
      expect(store.canUseAgent()).toBe(true);
    });

    it('is false when Google rejects the key', async () => {
      const fake = new FakeGenAI();
      fake.listError = new FakeApiError(401, 'API key not valid');
      const { store } = setup(fake);
      store.saveKey(KEY, false);
      await settled(store);
      expect(store.canUseAgent()).toBe(false);
    });

    it('stays true when the check itself could not run', async () => {
      const fake = new FakeGenAI();
      fake.listError = new FakeApiError(503, 'down');
      const { store } = setup(fake);
      store.saveKey(KEY, false);
      await settled(store);
      expect(store.keyStatus()).toBe('unreachable');
      expect(store.canUseAgent()).toBe(true);
    });
  });

  describe('toVerdict', () => {
    it.each([400, 401, 403])('maps %i to an invalid key', (status) => {
      expect(toVerdict(new FakeApiError(status))).toMatchObject({ ok: false, reason: 'invalid' });
    });

    it('maps other failures to unreachable and keeps the message', () => {
      expect(toVerdict(new FakeApiError(503, 'down'))).toEqual({
        ok: false,
        reason: 'unreachable',
        message: 'down',
      });
      expect(toVerdict('plain')).toMatchObject({ reason: 'unreachable', message: 'plain' });
    });
  });
});
