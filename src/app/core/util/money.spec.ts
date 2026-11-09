import { formatCompactCurrency, netValue, roundMoney } from './money';

describe('roundMoney', () => {
  it('rounds to cents', () => {
    expect(roundMoney(10.005)).toBe(10.01);
    expect(roundMoney(10.004)).toBe(10);
  });

  it('removes floating point noise', () => {
    expect(roundMoney(420000 * (1 - 0.15))).toBe(357000);
    expect(roundMoney(0.1 + 0.2)).toBe(0.3);
  });
});

describe('netValue', () => {
  it.each([
    [0, 420000],
    [15, 357000],
    [50, 210000],
  ])('applies a %s%% discount', (discountPct, expected) => {
    expect(netValue({ listValue: 420000, discountPct })).toBe(expected);
  });

  it('rounds fractional results to cents', () => {
    expect(netValue({ listValue: 99999, discountPct: 7 })).toBe(92999.07);
  });
});

describe('formatCompactCurrency', () => {
  it.each([
    [0, '$0'],
    [950, '$950'],
    [1000, '$1k'],
    [420000, '$420k'],
    [1250, '$1.3k'],
    [1000000, '$1M'],
    [1400000, '$1.4M'],
    [2500000000, '$2.5B'],
    [1200000000000, '$1200B'],
  ])('formats %s as %s', (amount, expected) => {
    expect(formatCompactCurrency(amount)).toBe(expected);
  });

  it('promotes to the next unit when rounding reaches 1000', () => {
    expect(formatCompactCurrency(999950)).toBe('$1M');
    expect(formatCompactCurrency(999940)).toBe('$999.9k');
  });

  it('keeps the sign for negative amounts', () => {
    expect(formatCompactCurrency(-105000)).toBe('-$105k');
  });
});
