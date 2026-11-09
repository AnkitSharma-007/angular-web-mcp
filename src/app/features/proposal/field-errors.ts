import { Component, computed, input } from '@angular/core';

interface FieldErrorSource {
  touched(): boolean;
  errors(): readonly { kind: string; message?: string | undefined }[];
}

@Component({
  selector: 'app-field-errors',
  templateUrl: './field-errors.html',
  host: { class: 'block' },
})
export class FieldErrors {
  readonly field = input.required<() => FieldErrorSource>();

  protected readonly messages = computed(() => {
    const state = this.field()();
    return state.touched() ? state.errors().map((e) => e.message ?? e.kind) : [];
  });
}
