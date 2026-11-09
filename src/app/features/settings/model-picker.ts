import { Component, computed, inject, model } from '@angular/core';
import { Listbox, Option } from '@angular/aria/listbox';
import { CLOCK } from '../../core/util/clock';
import { GEMINI_MODELS, priceAt, type GeminiModelId } from '../../mcp/agent/gemini/gemini-models';

@Component({
  selector: 'app-model-picker',
  imports: [Listbox, Option],
  templateUrl: './model-picker.html',
  host: { class: 'block' },
})
export class ModelPicker {
  private readonly clock = inject(CLOCK);

  readonly value = model.required<GeminiModelId>();

  protected readonly selection = computed(() => [this.value()]);
  protected readonly cards = computed(() => {
    const now = this.clock();
    return GEMINI_MODELS.map((entry) => ({ ...entry, price: priceAt(entry, now) }));
  });

  protected choose(next: readonly GeminiModelId[]): void {
    const [first] = next;
    if (first !== undefined) {
      this.value.set(first);
    }
  }
}
