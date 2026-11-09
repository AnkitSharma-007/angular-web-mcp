import { computed, inject, resource } from '@angular/core';
import {
  patchState,
  signalStore,
  withComputed,
  withMethods,
  withProps,
  withState,
} from '@ngrx/signals';
import {
  DEFAULT_MODEL_ID,
  findModel,
  type GeminiModelId,
} from '../../mcp/agent/gemini/gemini-models';
import { GENAI_CLIENT_FACTORY } from '../../mcp/agent/gemini/genai-client';

export const KEY_CHECK_TIMEOUT_MS = 10_000;
export const API_KEY_STORAGE_KEY = 'awm.apiKey';
export const MODEL_STORAGE_KEY = 'awm.model';

export type KeyStatus = 'missing' | 'checking' | 'valid' | 'invalid' | 'unreachable';

export type KeyVerdict =
  { ok: true } | { ok: false; reason: 'invalid' | 'unreachable'; message: string };

interface SettingsState {
  apiKey: string;
  remember: boolean;
  model: GeminiModelId;
}

type StorageKind = 'session' | 'local';

function guarded<T>(action: () => T, fallback: T): T {
  try {
    return action();
  } catch {
    return fallback;
  }
}

const storageOf = (kind: StorageKind): Storage =>
  kind === 'session' ? sessionStorage : localStorage;

const readItem = (kind: StorageKind, key: string): string | null =>
  guarded(() => storageOf(kind).getItem(key), null);

const writeItem = (kind: StorageKind, key: string, value: string): void =>
  guarded(() => storageOf(kind).setItem(key, value), undefined);

const removeItem = (kind: StorageKind, key: string): void =>
  guarded(() => storageOf(kind).removeItem(key), undefined);

function initialState(): SettingsState {
  const remembered = readItem('local', API_KEY_STORAGE_KEY);
  const apiKey = remembered ?? readItem('session', API_KEY_STORAGE_KEY) ?? '';
  const stored = readItem('local', MODEL_STORAGE_KEY);
  const model = stored && findModel(stored) ? (stored as GeminiModelId) : DEFAULT_MODEL_ID;
  return { apiKey, remember: remembered !== null, model };
}

function statusOf(error: unknown): number | undefined {
  const status = (error as { status?: unknown } | null)?.status;
  return typeof status === 'number' ? status : undefined;
}

export function toVerdict(error: unknown): KeyVerdict {
  const status = statusOf(error);
  const message = error instanceof Error ? error.message : String(error);
  if (status === 429) {
    return { ok: true };
  }
  if (status === 400 || status === 401 || status === 403) {
    return { ok: false, reason: 'invalid', message };
  }
  return { ok: false, reason: 'unreachable', message };
}

export const SettingsStore = signalStore(
  { providedIn: 'root' },
  withState<SettingsState>(initialState),
  withProps(({ apiKey }) => {
    const createClient = inject(GENAI_CLIENT_FACTORY);
    return {
      keyCheck: resource<KeyVerdict, string | undefined>({
        params: () => apiKey().trim() || undefined,
        loader: async ({ params, abortSignal }) => {
          const deadline = new AbortController();
          const timer = setTimeout(() => deadline.abort(), KEY_CHECK_TIMEOUT_MS);
          try {
            const client = await createClient(params);
            await client.models.list({
              config: { pageSize: 1, abortSignal: AbortSignal.any([abortSignal, deadline.signal]) },
            });
            return { ok: true };
          } catch (error) {
            return deadline.signal.aborted && !abortSignal.aborted
              ? {
                  ok: false,
                  reason: 'unreachable',
                  message: `Gemini did not answer within ${KEY_CHECK_TIMEOUT_MS / 1000}s`,
                }
              : toVerdict(error);
          } finally {
            clearTimeout(timer);
          }
        },
      }),
    };
  }),
  withComputed(({ apiKey, keyCheck }) => ({
    hasKey: computed(() => apiKey().trim() !== ''),
    keyStatus: computed<KeyStatus>(() => {
      if (apiKey().trim() === '') {
        return 'missing';
      }
      const verdict = keyCheck.value();
      if (keyCheck.isLoading() || verdict === undefined) {
        return 'checking';
      }
      return verdict.ok ? 'valid' : verdict.reason;
    }),
  })),
  withComputed(({ keyStatus }) => ({
    canUseAgent: computed(() => keyStatus() !== 'missing' && keyStatus() !== 'invalid'),
  })),
  withMethods((store) => ({
    saveKey(rawKey: string, remember: boolean): void {
      const key = rawKey.trim();
      patchState(store, { apiKey: key, remember: key !== '' && remember });
      removeItem('local', API_KEY_STORAGE_KEY);
      removeItem('session', API_KEY_STORAGE_KEY);
      if (key !== '') {
        writeItem('session', API_KEY_STORAGE_KEY, key);
        if (remember) {
          writeItem('local', API_KEY_STORAGE_KEY, key);
        }
      }
    },
    setModel(model: GeminiModelId): void {
      patchState(store, { model });
      writeItem('local', MODEL_STORAGE_KEY, model);
    },
    forgetKey(): void {
      patchState(store, { apiKey: '', remember: false });
      removeItem('local', API_KEY_STORAGE_KEY);
      removeItem('session', API_KEY_STORAGE_KEY);
    },
  })),
);
