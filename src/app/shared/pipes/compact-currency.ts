import { Pipe, type PipeTransform } from '@angular/core';
import { formatCompactCurrency } from '../../core/util/money';

@Pipe({ name: 'compactCurrency' })
export class CompactCurrencyPipe implements PipeTransform {
  transform(value: number | null | undefined): string {
    return value == null ? '' : formatCompactCurrency(value);
  }
}
