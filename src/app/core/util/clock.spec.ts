import { TestBed } from '@angular/core/testing';
import { CLOCK } from './clock';

describe('CLOCK', () => {
  afterEach(() => vi.useRealTimers());

  it('returns the current time by default', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-11-09T10:00:00Z'));
    expect(TestBed.inject(CLOCK)().toISOString()).toBe('2026-11-09T10:00:00.000Z');
  });

  it('can be overridden in tests', () => {
    TestBed.configureTestingModule({
      providers: [{ provide: CLOCK, useValue: () => new Date('2030-01-01T00:00:00Z') }],
    });
    expect(TestBed.inject(CLOCK)().getUTCFullYear()).toBe(2030);
  });
});
