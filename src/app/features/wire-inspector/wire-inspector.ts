import { Listbox, Option } from '@angular/aria/listbox';
import { DecimalPipe } from '@angular/common';
import { Component, DestroyRef, computed, inject, signal } from '@angular/core';
import { MatButton, MatIconButton } from '@angular/material/button';
import { MatIcon } from '@angular/material/icon';
import { MatTab, MatTabGroup } from '@angular/material/tabs';
import { McpToolGateway } from '../../mcp/agent/mcp-tool-gateway';
import { WireTelemetryStore } from '../../mcp/telemetry/wire-telemetry-store';
import { StatTile } from '../../shared/ui/stat-tile/stat-tile';
import { copyText } from '../lab/download-text';
import { LayoutStore } from '../layout/layout-store';
import { JsonView } from './json-view';
import { PacketDetail } from './packet-detail';
import {
  CHANNEL_LABELS,
  CHANNEL_STYLES,
  STATUS_LABELS,
  STATUS_STYLES,
  describeTools,
  formatCost,
  formatLatency,
  formatTokens,
  humanWait,
  packetTitle,
} from './packet-format';

const COPY_FEEDBACK_MS = 2000;

@Component({
  selector: 'app-wire-inspector',
  imports: [
    DecimalPipe,
    JsonView,
    Listbox,
    MatButton,
    MatIcon,
    MatIconButton,
    MatTab,
    MatTabGroup,
    Option,
    PacketDetail,
    StatTile,
  ],
  templateUrl: './wire-inspector.html',
  host: { class: 'block', '(keydown.escape)': 'close()' },
})
export class WireInspector {
  protected readonly layout = inject(LayoutStore);
  protected readonly telemetry = inject(WireTelemetryStore);
  private readonly gateway = inject(McpToolGateway);

  private readonly selectedId = signal<number | null>(null);
  protected readonly copyStatus = signal<'copied' | 'failed' | null>(null);
  private copyTimer: ReturnType<typeof setTimeout> | undefined;

  protected readonly packets = computed(() => {
    const runId = this.layout.inspectorRunId();
    const all = this.telemetry.entities();
    return (runId === null ? [...all] : all.filter((packet) => packet.runId === runId)).reverse();
  });

  protected readonly rows = computed(() =>
    this.packets().map((packet) => ({
      id: packet.id,
      title: packetTitle(packet),
      channel: packet.channel,
      channelLabel: CHANNEL_LABELS[packet.channel],
      channelStyle: CHANNEL_STYLES[packet.channel],
      status: packet.status,
      statusLabel: STATUS_LABELS[packet.status],
      statusStyle: STATUS_STYLES[packet.status],
      latency: formatLatency(packet.latencyMs),
      tokens: packet.tokens ? formatTokens(packet.tokens) : null,
      cost: packet.costUsd === undefined ? null : formatCost(packet.costUsd),
    })),
  );

  protected readonly selected = computed(
    () => this.packets().find((packet) => packet.id === this.selectedId()) ?? null,
  );
  protected readonly selection = computed(() => {
    const packet = this.selected();
    return packet ? [packet.id] : [];
  });

  protected readonly tools = computed(() =>
    describeTools(this.gateway.tools(), this.gateway.lastChange()),
  );

  protected readonly stats = this.telemetry.stats;
  protected readonly byModel = this.telemetry.byModel;
  protected readonly wait = computed(() => humanWait(this.telemetry.entities()));
  protected readonly errorRate = computed(() => `${Math.round(this.stats().errorRate * 100)}%`);

  constructor() {
    inject(DestroyRef).onDestroy(() => clearTimeout(this.copyTimer));
  }

  protected select(ids: readonly number[]): void {
    this.selectedId.set(ids[0] ?? null);
  }

  protected togglePause(): void {
    if (this.telemetry.paused()) {
      this.telemetry.resume();
    } else {
      this.telemetry.pause();
    }
  }

  protected clear(): void {
    this.telemetry.clear();
    this.selectedId.set(null);
  }

  protected async copy(): Promise<void> {
    const copied = await copyText(this.telemetry.exportJson());
    this.copyStatus.set(copied ? 'copied' : 'failed');
    clearTimeout(this.copyTimer);
    this.copyTimer = setTimeout(() => this.copyStatus.set(null), COPY_FEEDBACK_MS);
  }

  protected close(): void {
    if (this.layout.inspectorOpen()) {
      this.layout.toggleInspector();
    }
  }
}
