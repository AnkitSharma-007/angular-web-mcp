import { DOCUMENT } from '@angular/common';
import { computed, effect, inject, Service, signal } from '@angular/core';

export type ThemeMode = 'light' | 'dark';

export const THEME_STORAGE_KEY = 'awm.theme';

@Service()
export class ThemeService {
  private readonly document = inject(DOCUMENT);
  private readonly state = signal<ThemeMode>(readStoredMode());

  readonly mode = this.state.asReadonly();
  readonly isDark = computed(() => this.state() === 'dark');

  private readonly syncRootClass = effect(() => {
    this.document.documentElement.classList.toggle('dark', this.isDark());
  });

  setMode(mode: ThemeMode): void {
    this.state.set(mode);
    persistMode(mode);
  }

  toggle(): void {
    this.setMode(this.isDark() ? 'light' : 'dark');
  }
}

function readStoredMode(): ThemeMode {
  try {
    const stored = localStorage.getItem(THEME_STORAGE_KEY);
    return stored === 'light' || stored === 'dark' ? stored : 'light';
  } catch {
    return 'light';
  }
}

function persistMode(mode: ThemeMode): void {
  try {
    localStorage.setItem(THEME_STORAGE_KEY, mode);
  } catch {
    return;
  }
}
