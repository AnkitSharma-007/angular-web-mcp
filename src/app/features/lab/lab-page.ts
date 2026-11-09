import { Component } from '@angular/core';
import { GlassCard } from '../../shared/ui/glass-card/glass-card';

@Component({
  selector: 'app-lab-page',
  imports: [GlassCard],
  templateUrl: './lab-page.html',
  host: { class: 'block' },
})
export class LabPage {}
