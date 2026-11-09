import { TestBed } from '@angular/core/testing';
import { LayoutStore } from './layout-store';

describe('LayoutStore', () => {
  it('starts with the console and inspector closed', () => {
    const store = TestBed.inject(LayoutStore);
    expect(store.consoleOpen()).toBe(false);
    expect(store.inspectorOpen()).toBe(false);
  });

  it('toggles the console and inspector independently', () => {
    const store = TestBed.inject(LayoutStore);
    store.toggleConsole();
    expect(store.consoleOpen()).toBe(true);
    expect(store.inspectorOpen()).toBe(false);
    store.toggleInspector();
    store.toggleConsole();
    expect(store.consoleOpen()).toBe(false);
    expect(store.inspectorOpen()).toBe(true);
  });

  it('opens the console without toggling it closed', () => {
    const store = TestBed.inject(LayoutStore);
    store.openConsole();
    store.openConsole();
    expect(store.consoleOpen()).toBe(true);
  });

  it('opens the inspector on a run and keeps it open when the filter is cleared', () => {
    const store = TestBed.inject(LayoutStore);
    expect(store.inspectorRunId()).toBeNull();
    store.showRun('run-3');
    expect(store.inspectorOpen()).toBe(true);
    expect(store.inspectorRunId()).toBe('run-3');
    store.showRun(null);
    expect(store.inspectorOpen()).toBe(true);
    expect(store.inspectorRunId()).toBeNull();
  });

  it('does not open a closed inspector when the run filter is cleared', () => {
    const store = TestBed.inject(LayoutStore);
    store.showRun(null);
    expect(store.inspectorOpen()).toBe(false);
  });
});
