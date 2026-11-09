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
});
