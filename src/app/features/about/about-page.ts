import { Component } from '@angular/core';
import { RouterLink } from '@angular/router';
import { GlassCard } from '../../shared/ui/glass-card/glass-card';

@Component({
  selector: 'app-about-page',
  imports: [GlassCard, RouterLink],
  templateUrl: './about-page.html',
  host: { class: 'mx-auto block max-w-3xl' },
})
export class AboutPage {}
