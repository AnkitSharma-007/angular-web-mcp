import { TestBed } from '@angular/core/testing';
import { appConfig } from './app.config';
import { SettingsStore } from './features/settings/settings-store';
import { AGENT_CONFIG } from './mcp/agent/agent-config';
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
