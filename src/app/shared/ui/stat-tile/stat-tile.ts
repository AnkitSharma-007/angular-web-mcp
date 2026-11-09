import { Component, input } from '@angular/core';
import { GlassCard, type GlassCardAccent } from '../glass-card/glass-card';

@Component({
  selector: 'app-stat-tile',
  imports: [GlassCard],
  templateUrl: './stat-tile.html',
  host: { class: 'block' },
})
export class StatTile {
  readonly label = input.required<string>();
  readonly value = input.required<string>();
  readonly hint = input('');
  readonly accent = input<GlassCardAccent>('primary');
}
