import { Component, computed, input } from '@angular/core';

export type GlassCardAccent = 'primary' | 'warn' | 'success';

const ACCENT_CLASSES: Record<GlassCardAccent, string> = {
  primary: 'glass-accent-primary',
  warn: 'glass-accent-warn',
  success: 'glass-accent-success',
};

@Component({
  selector: 'app-glass-card',
  templateUrl: './glass-card.html',
  host: {
    class: 'glass block rounded-2xl p-4',
    '[class]': 'accentClass()',
    '[attr.title]': 'null',
  },
})
export class GlassCard {
  readonly title = input('');
  readonly accent = input<GlassCardAccent>('primary');

  protected readonly accentClass = computed(() => ACCENT_CLASSES[this.accent()]);
}
