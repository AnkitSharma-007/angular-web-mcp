import { TestBed } from '@angular/core/testing';
import { THEME_STORAGE_KEY, ThemeService } from './theme';

describe('ThemeService', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    localStorage.clear();
    document.documentElement.classList.remove('dark');
  });

  it('defaults to dark and applies the root class', () => {
    const theme = TestBed.inject(ThemeService);
    TestBed.tick();
    expect(theme.mode()).toBe('dark');
    expect(theme.isDark()).toBe(true);
    expect(document.documentElement.classList.contains('dark')).toBe(true);
  });

  it('toggle flips the html class after a tick', () => {
    const theme = TestBed.inject(ThemeService);
    TestBed.tick();
    theme.toggle();
    TestBed.tick();
    expect(theme.mode()).toBe('light');
    expect(document.documentElement.classList.contains('dark')).toBe(false);
    theme.toggle();
    TestBed.tick();
    expect(theme.mode()).toBe('dark');
    expect(document.documentElement.classList.contains('dark')).toBe(true);
  });

  it('persists the mode and restores it in a fresh instance', () => {
    TestBed.inject(ThemeService).setMode('light');
    expect(localStorage.getItem(THEME_STORAGE_KEY)).toBe('light');

    TestBed.resetTestingModule();
    const restored = TestBed.inject(ThemeService);
    TestBed.tick();
    expect(restored.mode()).toBe('light');
    expect(document.documentElement.classList.contains('dark')).toBe(false);
  });

  it('ignores an unrecognised stored value', () => {
    localStorage.setItem(THEME_STORAGE_KEY, 'sepia');
    expect(TestBed.inject(ThemeService).mode()).toBe('dark');
  });

  it('falls back to dark when localStorage throws', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('denied');
    });
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('denied');
    });
    const theme = TestBed.inject(ThemeService);
    expect(theme.mode()).toBe('dark');
    expect(() => theme.setMode('light')).not.toThrow();
    expect(theme.mode()).toBe('light');
  });
});
