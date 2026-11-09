import { DatePipe } from '@angular/common';
import { Component, computed, input } from '@angular/core';
import type { WirePacket } from '../../mcp/telemetry/wire-packet';
import { JsonView } from './json-view';
import {
  CHANNEL_LABELS,
  STATUS_LABELS,
  formatCost,
  formatLatency,
  formatTokens,
  packetTitle,
} from './packet-format';

@Component({
  selector: 'app-packet-detail',
  imports: [DatePipe, JsonView],
  templateUrl: './packet-detail.html',
  host: { class: 'block' },
})
export class PacketDetail {
  readonly packet = input.required<WirePacket>();

  protected readonly title = computed(() => packetTitle(this.packet()));
  protected readonly channel = computed(() => CHANNEL_LABELS[this.packet().channel]);
  protected readonly status = computed(() => STATUS_LABELS[this.packet().status]);
  protected readonly latency = computed(() => formatLatency(this.packet().latencyMs));
  protected readonly tokens = computed(() => formatTokens(this.packet().tokens));
  protected readonly cost = computed(() => formatCost(this.packet().costUsd));
}
