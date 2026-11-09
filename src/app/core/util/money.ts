import type { Deal } from '../models/deal';

const COMPACT_UNITS = [
  { limit: 1e3, suffix: 'k' },
  { limit: 1e6, suffix: 'M' },
  { limit: 1e9, suffix: 'B' },
] as const;

export function roundMoney(amount: number): number {
  return Math.round((amount + Number.EPSILON) * 100) / 100;
}

export function netValue(deal: Pick<Deal, 'listValue' | 'discountPct'>): number {
  return roundMoney(deal.listValue * (1 - deal.discountPct / 100));
}

export function formatCompactCurrency(amount: number): string {
  const sign = amount < 0 ? '-' : '';
  const abs = Math.abs(amount);
  let index = COMPACT_UNITS.filter((unit) => abs >= unit.limit).length - 1;
  if (index < 0) {
    return `${sign}$${trimDecimals(abs, 0)}`;
  }
  let scaled = roundToTenth(abs / COMPACT_UNITS[index]!.limit);
  const next = COMPACT_UNITS[index + 1];
  if (scaled >= 1000 && next) {
    index += 1;
    scaled = roundToTenth(abs / next.limit);
  }
  return `${sign}$${trimDecimals(scaled, 1)}${COMPACT_UNITS[index]!.suffix}`;
}

function roundToTenth(value: number): number {
  return Math.round(value * 10) / 10;
}

function trimDecimals(value: number, digits: number): string {
  return value.toFixed(digits).replace(/\.0+$/, '');
}
