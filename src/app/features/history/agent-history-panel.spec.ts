import { TestBed } from '@angular/core/testing';
import { MatButtonHarness } from '@angular/material/button/testing';
import { TestbedHarnessEnvironment } from '@angular/cdk/testing/testbed';
import { WireTelemetryStore } from '../../mcp/telemetry/wire-telemetry-store';
import { expectNoA11yViolations } from '../../../testing/a11y';
import { DealsStore } from '../dashboard/data/deals-store';
import { AgentHistoryPanel } from './agent-history-panel';

async function setup() {
  TestBed.configureTestingModule({ providers: [DealsStore] });
  const store = TestBed.inject(DealsStore);
  const fixture = TestBed.createComponent(AgentHistoryPanel);
  await fixture.whenStable();
  return {
    fixture,
    store,
    root: fixture.nativeElement as HTMLElement,
    loader: TestbedHarnessEnvironment.loader(fixture),
  };
}

describe('AgentHistoryPanel', () => {
  it('renders nothing until the agent has changed something', async () => {
    const { root } = await setup();
    expect(root.querySelector('section')).toBeNull();
  });

  it('lists entries newest first', async () => {
    const { fixture, store, root } = await setup();
    store.recordSnapshot('10% discount on 3 deals');
    store.recordSnapshot('Stage updates on 1 deal');
    await fixture.whenStable();

    const labels = [...root.querySelectorAll('[data-testid="entry-label"]')].map((el) =>
      el.textContent?.trim(),
    );
    expect(labels).toEqual(['Stage updates on 1 deal', '10% discount on 3 deals']);
    expect(root.querySelectorAll('time')).toHaveLength(2);
  });

  it('restores the state before the chosen step and drops later steps', async () => {
    const { fixture, store, loader } = await setup();
    store.recordSnapshot('first');
    store.applyDiscount(['D-1002'], 10);
    store.recordSnapshot('second');
    store.moveStages([{ dealId: 'D-1002', stage: 'proposal' }]);
    await fixture.whenStable();

    const buttons = await loader.getAllHarnesses(MatButtonHarness.with({ text: 'Undo to here' }));
    expect(buttons).toHaveLength(2);
    await buttons[1]?.click();

    expect(store.entityMap()['D-1002']).toMatchObject({ discountPct: 0, stage: 'negotiation' });
    expect(store.history()).toHaveLength(0);
    expect(fixture.nativeElement.querySelector('section')).toBeNull();
  });

  it('undoing the newest step keeps the older ones and records a human/undo packet', async () => {
    const { fixture, store, loader } = await setup();
    store.recordSnapshot('first');
    store.applyDiscount(['D-1002'], 10);
    store.recordSnapshot('second');
    store.applyDiscount(['D-1002'], 20);
    await fixture.whenStable();

    const [newest] = await loader.getAllHarnesses(MatButtonHarness.with({ text: 'Undo to here' }));
    await newest?.click();

    expect(store.entityMap()['D-1002']?.discountPct).toBe(10);
    expect(store.history().map((entry) => entry.label)).toEqual(['first']);
    const [packet] = TestBed.inject(WireTelemetryStore).entities();
    expect(packet?.envelope.request).toMatchObject({
      method: 'human/undo',
      params: { label: 'second', source: 'panel' },
    });
  });

  it('labels each action for assistive technology and passes axe', async () => {
    const { fixture, store, root } = await setup();
    store.recordSnapshot('10% discount on 3 deals');
    await fixture.whenStable();

    const button = root.querySelector('button');
    expect(button?.getAttribute('aria-label')).toBe('Undo to here: 10% discount on 3 deals');
    const main = document.createElement('main');
    document.body.append(main);
    main.append(root);
    await expectNoA11yViolations(main);
    main.remove();
  });
});
