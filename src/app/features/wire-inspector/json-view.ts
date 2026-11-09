import { Component, computed, input, linkedSignal } from '@angular/core';

export type JsonKind = 'null' | 'string' | 'number' | 'boolean' | 'array' | 'object';

export interface JsonChild {
  key: string;
  value: unknown;
}

export function jsonKind(value: unknown): JsonKind {
  if (value === null || value === undefined) {
    return 'null';
  }
  if (Array.isArray(value)) {
    return 'array';
  }
  switch (typeof value) {
    case 'string':
      return 'string';
    case 'number':
      return 'number';
    case 'boolean':
      return 'boolean';
    default:
      return 'object';
  }
}

export function jsonChildren(value: unknown): JsonChild[] {
  if (Array.isArray(value)) {
    return value.map((item, index) => ({ key: String(index), value: item }));
  }
  if (value !== null && typeof value === 'object') {
    return Object.entries(value).map(([key, item]) => ({ key, value: item }));
  }
  return [];
}

@Component({
  selector: 'app-json-view',
  templateUrl: './json-view.html',
  host: { class: 'block font-mono text-xs leading-5' },
})
export class JsonView {
  readonly value = input.required<unknown>();
  readonly name = input<string | null>(null);
  readonly depth = input(0);
  readonly initialDepth = input(2);

  protected readonly kind = computed(() => jsonKind(this.value()));
  protected readonly children = computed(() => jsonChildren(this.value()));
  protected readonly expandable = computed(() => this.children().length > 0);
  protected readonly open = linkedSignal(() => this.depth() < this.initialDepth());

  protected readonly summary = computed(() => {
    const count = this.children().length;
    if (this.kind() === 'array') {
      return count === 0 ? '[]' : `[${count}]`;
    }
    return count === 0 ? '{}' : `{${count}}`;
  });

  protected readonly leafText = computed(() => {
    const value = this.value();
    return this.kind() === 'null' ? 'null' : (JSON.stringify(value) ?? String(value));
  });

  protected toggle(): void {
    this.open.update((open) => !open);
  }
}
