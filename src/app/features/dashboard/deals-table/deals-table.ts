import {
  Component,
  DestroyRef,
  computed,
  debounced,
  effect,
  inject,
  linkedSignal,
  signal,
  untracked,
} from '@angular/core';
import { form, FormField } from '@angular/forms/signals';
import { MatButton } from '@angular/material/button';
import { MatChip, MatChipRemove, MatChipSet } from '@angular/material/chips';
import { MatFormField, MatLabel, MatPrefix } from '@angular/material/form-field';
import { MatIcon } from '@angular/material/icon';
import { MatInput } from '@angular/material/input';
import { MatSort, MatSortHeader, type Sort } from '@angular/material/sort';
import { MatTableModule } from '@angular/material/table';
import { DEAL_STAGE_LABELS, isStalled, type Deal } from '../../../core/models/deal';
import { formatCompactCurrency, netValue } from '../../../core/util/money';
import { CompactCurrencyPipe } from '../../../shared/pipes/compact-currency';
import { StageBadge } from '../../../shared/ui/stage-badge/stage-badge';
import { DashboardUiStore } from '../data/dashboard-ui-store';
import { DealsStore } from '../data/deals-store';
import { sortDeals } from './sort-deals';

export const FLASH_DURATION_MS = 2000;
export const SEARCH_DEBOUNCE_MS = 250;

interface FilterChip {
  key: string;
  label: string;
  remove: () => void;
}

function dealChanged(previous: Deal, next: Deal): boolean {
  return (Object.keys(next) as (keyof Deal)[]).some((field) => previous[field] !== next[field]);
}

@Component({
  selector: 'app-deals-table',
  imports: [
    MatTableModule,
    MatSort,
    MatSortHeader,
    MatChipSet,
    MatChip,
    MatChipRemove,
    MatButton,
    MatFormField,
    MatLabel,
    MatPrefix,
    MatInput,
    MatIcon,
    FormField,
    StageBadge,
    CompactCurrencyPipe,
  ],
  templateUrl: './deals-table.html',
  host: { class: 'block' },
})
export class DealsTable {
  protected readonly store = inject(DealsStore);
  protected readonly ui = inject(DashboardUiStore);
  private readonly destroyRef = inject(DestroyRef);

  protected readonly columns = [
    'account',
    'owner',
    'region',
    'stage',
    'netValue',
    'discountPct',
    'probability',
    'closeDate',
    'lastActivityDays',
  ];
  protected readonly netValue = netValue;
  protected readonly isStalled = isStalled;
  protected readonly trackById = (_index: number, deal: Deal) => deal.id;

  protected readonly sort = signal<Sort>({ active: '', direction: '' });
  protected readonly rows = computed(() => sortDeals(this.store.filteredDeals(), this.sort()));

  protected readonly searchModel = linkedSignal(() => ({ query: this.store.filter().query }));
  protected readonly searchForm = form(this.searchModel);
  private readonly debouncedQuery = debounced(() => this.searchModel().query, SEARCH_DEBOUNCE_MS);

  protected readonly chips = computed<FilterChip[]>(() => {
    const { stages, regions, minValue } = this.store.filter();
    const toggle = (stage: string) => () =>
      this.store.setFilter({ stages: stages.filter((s) => s !== stage) });
    return [
      ...stages.map((stage) => ({
        key: `stage:${stage}`,
        label: DEAL_STAGE_LABELS[stage],
        remove: toggle(stage),
      })),
      ...regions.map((region) => ({
        key: `region:${region}`,
        label: region,
        remove: () => this.store.setFilter({ regions: regions.filter((r) => r !== region) }),
      })),
      ...(minValue === null
        ? []
        : [
            {
              key: 'minValue',
              label: `Net ≥ ${formatCompactCurrency(minValue)}`,
              remove: () => this.store.setFilter({ minValue: null }),
            },
          ]),
    ];
  });

  protected readonly flashing = signal<ReadonlySet<string>>(new Set());
  private known = new Map<string, Deal>();
  private readonly timers = new Map<string, ReturnType<typeof setTimeout>>();

  private readonly applyQuery = effect(() => {
    if (!this.debouncedQuery.hasValue()) {
      return;
    }
    const query = this.debouncedQuery.value();
    untracked(() => {
      if (query !== this.store.filter().query) {
        this.store.setFilter({ query });
      }
    });
  });

  private readonly trackChanges = effect(() => {
    const deals = this.store.entities();
    const changed = deals
      .filter((deal) => {
        const previous = this.known.get(deal.id);
        return previous !== undefined && dealChanged(previous, deal);
      })
      .map((deal) => deal.id);
    this.known = new Map(deals.map((deal) => [deal.id, deal]));
    untracked(() => this.flash(changed));
  });

  constructor() {
    this.destroyRef.onDestroy(() => this.timers.forEach((timer) => clearTimeout(timer)));
  }

  protected clearFilters(): void {
    this.store.clearFilter();
  }

  private flash(ids: readonly string[]): void {
    if (ids.length === 0) {
      return;
    }
    this.flashing.update((current) => new Set([...current, ...ids]));
    for (const id of ids) {
      clearTimeout(this.timers.get(id));
      this.timers.set(
        id,
        setTimeout(() => {
          this.timers.delete(id);
          this.flashing.update(
            (current) => new Set([...current].filter((flashed) => flashed !== id)),
          );
        }, FLASH_DURATION_MS),
      );
    }
  }
}
