import { CompactCurrencyPipe } from './compact-currency';

describe('CompactCurrencyPipe', () => {
  const pipe = new CompactCurrencyPipe();

  it.each([
    [420000, '$420k'],
    [1400000, '$1.4M'],
    [2500000000, '$2.5B'],
  ])('formats %s as %s', (value, expected) => {
    expect(pipe.transform(value)).toBe(expected);
  });

  it('returns an empty string for null and undefined', () => {
    expect(pipe.transform(null)).toBe('');
    expect(pipe.transform(undefined)).toBe('');
  });
});
