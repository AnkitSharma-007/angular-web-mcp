import { TestBed } from '@angular/core/testing';
import { useFakeModelContext } from '../../../../testing/test-providers';
import { WireTelemetryStore } from '../../../mcp/telemetry/wire-telemetry-store';
import { DashboardUiStore } from '../data/dashboard-ui-store';
import { DealsStore } from '../data/deals-store';

function parse(result: unknown): Record<string, unknown> {
  const text = (result as { content: { text: string }[] }).content[0]!.text;
  return JSON.parse(text) as Record<string, unknown>;
}

describe('openProposalDrawer', () => {
  const registry = useFakeModelContext();

  function setup() {
    TestBed.configureTestingModule({ providers: [DealsStore, DashboardUiStore] });
    return TestBed.inject(DashboardUiStore);
  }

  it('is registered with the dashboard UI store', () => {
    setup();
    expect(registry.current.toolNames()).toContain('openProposalDrawer');
    const info = registry.current.toolInfos().find((t) => t.name === 'openProposalDrawer');
    expect(info?.annotations).toBeUndefined();
    expect(info?.inputSchema).toMatchObject({ required: ['dealId'], additionalProperties: false });
  });

  it('opens the drawer for the deal and points at the form tool', async () => {
    const ui = setup();
    const result = parse(
      await registry.current.callOrThrow('openProposalDrawer', { dealId: 'D-1001' }),
    );
    expect(ui.proposalOpen()).toBe(true);
    expect(ui.proposalDealId()).toBe('D-1001');
    expect(result).toEqual({
      opened: true,
      alreadyOpen: false,
      dealId: 'D-1001',
      account: 'Konkan Freight',
      nextTool: 'draftDealProposal',
    });
  });

  it('reports when the drawer was already open and switches the deal', async () => {
    const ui = setup();
    await registry.current.callOrThrow('openProposalDrawer', { dealId: 'D-1001' });
    const result = parse(
      await registry.current.callOrThrow('openProposalDrawer', { dealId: 'D-1002' }),
    );
    expect(result['alreadyOpen']).toBe(true);
    expect(ui.proposalDealId()).toBe('D-1002');
  });

  it('rejects an unknown deal without opening anything', async () => {
    const ui = setup();
    await expect(
      registry.current.callOrThrow('openProposalDrawer', { dealId: 'D-9999' }),
    ).rejects.toThrow(/Unknown deal D-9999/);
    expect(ui.proposalOpen()).toBe(false);
  });

  it('rejects a malformed deal ID and extra arguments', async () => {
    setup();
    await expect(
      registry.current.callOrThrow('openProposalDrawer', { dealId: 'nope' }),
    ).rejects.toThrow(/Invalid input/);
    await expect(
      registry.current.callOrThrow('openProposalDrawer', { dealId: 'D-1001', extra: 1 }),
    ).rejects.toThrow(/Invalid input/);
  });

  it('records one tools/call packet for the call, not two', async () => {
    setup();
    const telemetry = TestBed.inject(WireTelemetryStore);
    await registry.current.callOrThrow('openProposalDrawer', { dealId: 'D-1001' });
    const calls = telemetry.entities().filter((p) => p.method === 'tools/call');
    expect(calls).toHaveLength(1);
    expect(calls[0]?.status).toBe('ok');
  });

  it('forgets the deal when the drawer closes', async () => {
    const ui = setup();
    await registry.current.callOrThrow('openProposalDrawer', { dealId: 'D-1001' });
    ui.closeProposal();
    expect(ui.proposalOpen()).toBe(false);
    expect(ui.proposalDealId()).toBeNull();
  });
});
