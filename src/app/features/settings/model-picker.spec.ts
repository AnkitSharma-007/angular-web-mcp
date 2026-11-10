import { TestbedHarnessEnvironment } from '@angular/cdk/testing/testbed';
import { TestBed } from '@angular/core/testing';
import { ListboxHarness } from '@angular/aria/listbox/testing';
import { expectNoA11yViolations } from '../../../testing/a11y';
import { CLOCK } from '../../core/util/clock';
import { ModelPicker } from './model-picker';

async function render(now = '2026-11-09T00:00:00Z') {
  TestBed.configureTestingModule({
    providers: [{ provide: CLOCK, useValue: () => new Date(now) }],
  });
  const fixture = TestBed.createComponent(ModelPicker);
  fixture.componentRef.setInput('value', 'gemini-3.8-flash');
  await fixture.whenStable();
  const loader = TestbedHarnessEnvironment.loader(fixture);
  const listbox = await loader.getHarness(ListboxHarness);
  return { fixture, listbox, root: fixture.nativeElement as HTMLElement };
}

describe('ModelPicker', () => {
  it('shows the two models with the current one selected', async () => {
    const { listbox } = await render();
    const options = await listbox.getOptions();
    expect(options).toHaveLength(2);
    const selected = await listbox.getOptions({ selected: true });
    expect(await selected[0]?.getText()).toContain('Operator');
  });

  it('selects a model on click', async () => {
    const { fixture, listbox } = await render();
    const [sprinter] = await listbox.getOptions({ text: /Sprinter/ });
    await sprinter?.click();
    expect(fixture.componentInstance.value()).toBe('gemini-3.5-flash-lite');
  });

  it('selects with the keyboard', async () => {
    const { fixture, root } = await render();
    const list = root.querySelector<HTMLElement>('[ngListbox]')!;
    list.focus();
    list.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowUp', bubbles: true }));
    await fixture.whenStable();
    expect(fixture.componentInstance.value()).toBe('gemini-3.5-flash-lite');
    list.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }));
    await fixture.whenStable();
    expect(fixture.componentInstance.value()).toBe('gemini-3.8-flash');
  });

  it('shows the price in force on the current date', async () => {
    const before = await render('2026-12-31T12:00:00Z');
    expect(
      before.root.querySelector('[data-testid="model-gemini-3.8-flash"]')?.textContent,
    ).toContain('$0.75 in / $3.75 out');
    TestBed.resetTestingModule();
    const after = await render('2027-01-02T00:00:00Z');
    expect(
      after.root.querySelector('[data-testid="model-gemini-3.8-flash"]')?.textContent,
    ).toContain('$1.5 in / $7.5 out');
  });

  it('is free of axe violations', async () => {
    const { root } = await render();
    await expectNoA11yViolations(root);
  });
});
