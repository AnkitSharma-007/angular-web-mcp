import { TestBed } from '@angular/core/testing';
import { appConfig } from './app.config';
import { SettingsStore } from './features/settings/settings-store';
import { ApprovalService } from './features/approvals/approval-service';
import { AGENT_CONFIG } from './mcp/agent/agent-config';
import { HUMAN_APPROVAL_GATE } from './mcp/tooling/approval-gate';
import { WIRE_SECRETS, WireTelemetryStore } from './mcp/telemetry/wire-telemetry-store';

const KEY = 'AIza-test-key-0001';

describe('app config wiring', () => {
  beforeEach(() => {
    localStorage.clear();
    sessionStorage.clear();
    TestBed.configureTestingModule({ providers: appConfig.providers });
  });

  afterEach(() => {
    localStorage.clear();
    sessionStorage.clear();
  });

  it('serves the settings store as the agent config', () => {
    expect(TestBed.inject(AGENT_CONFIG)).toBe(TestBed.inject(SettingsStore));
  });

  it('exposes the approval service as the root gate', () => {
    expect(TestBed.inject(HUMAN_APPROVAL_GATE)).toBe(TestBed.inject(ApprovalService));
  });

  it('feeds the live key to telemetry redaction', () => {
    const settings = TestBed.inject(SettingsStore);
    expect(TestBed.inject(WIRE_SECRETS)()).toEqual(['']);
    settings.saveKey(KEY, false);
    expect(TestBed.inject(WIRE_SECRETS)()).toEqual([KEY]);

    const telemetry = TestBed.inject(WireTelemetryStore);
    telemetry.record(
      { channel: 'llm', method: 'generateContent', params: { note: `leaked ${KEY}` } },
      { status: 'ok' },
    );
    expect(telemetry.exportJson()).not.toContain(KEY);
  });
});
