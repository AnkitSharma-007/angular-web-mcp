import { TestbedHarnessEnvironment } from '@angular/cdk/testing/testbed';
import { TestBed } from '@angular/core/testing';
import { MatButtonHarness } from '@angular/material/button/testing';
import { MatDialog, type MatDialogRef } from '@angular/material/dialog';
import { MatDialogHarness } from '@angular/material/dialog/testing';
import { MatInputHarness } from '@angular/material/input/testing';
import { expectNoA11yViolations } from '../../../testing/a11y';
import type { ApprovalDecision, ApprovalRequest } from '../../mcp/tooling/approval-gate';
import { GlassCard } from '../../shared/ui/glass-card/glass-card';
import { ApprovalDialog } from './approval-dialog';

const DISCOUNT: ApprovalRequest = {
  toolName: 'applyBatchDiscount',
  risk: 'high',
  summary: 'Set a 20% discount on 2 deals (-$120k revenue)',
  reason: 'Quarter-end push',
  policy: ['Discount of 20% is above the 15% policy limit'],
  diff: [
    {
      label: 'Arcadia Bank (D-1002)',
      field: 'Discount',
      before: '0%',
      after: '20%',
      note: '-$84k',
    },
    {
      label: 'Helios Energy (D-1008)',
      field: 'Discount',
      before: '5%',
      after: '20%',
      note: '-$36k',
    },
  ],
};
const TERMINATE: ApprovalRequest = {
  toolName: 'terminateContract',
  risk: 'critical',
  summary: 'Terminate the contract with Konkan Freight (D-1001)',
  diff: [
    { label: 'Konkan Freight (D-1001)', field: 'Contract', before: 'active', after: 'terminated' },
  ],
};

function visibleToFocusTrap() {
  vi.spyOn(Element.prototype, 'getClientRects').mockReturnValue([{}] as unknown as DOMRectList);
}

async function open(request: ApprovalRequest) {
  const fixture = TestBed.createComponent(GlassCard);
  const ref: MatDialogRef<ApprovalDialog, ApprovalDecision> = TestBed.inject(MatDialog).open(
    ApprovalDialog,
    { data: request, disableClose: true, role: 'alertdialog' },
  );
  const closed = vi.fn();
  ref.afterClosed().subscribe(closed);
  const loader = TestbedHarnessEnvironment.documentRootLoader(fixture);
  const dialog = await loader.getHarness(MatDialogHarness);
  return { loader, dialog, closed };
}

describe('ApprovalDialog', () => {
  afterEach(() => {
    TestBed.inject(MatDialog).closeAll();
    vi.restoreAllMocks();
  });

  it('shows the summary, the reason, the policy flags and one row per change', async () => {
    const { dialog } = await open(DISCOUNT);
    const text = await dialog.getText();
    expect(text).toContain('Set a 20% discount on 2 deals');
    expect(text).toContain('Quarter-end push');
    expect(text).toContain('Discount of 20% is above the 15% policy limit');
    expect(text).toContain('High-impact action');

    const rows = [...document.querySelectorAll('[data-testid="diff-row"]')].map((row) =>
      [...row.children].map((cell) => cell.textContent?.trim()),
    );
    expect(rows).toEqual([
      ['Arcadia Bank (D-1002)', 'Discount', '0%', '20%', '-$84k'],
      ['Helios Energy (D-1008)', 'Discount', '5%', '20%', '-$36k'],
    ]);
  });

  it('omits the sections that a request does not carry', async () => {
    await open({ toolName: 'probe', risk: 'high', summary: 'Do the thing' });
    expect(document.querySelector('[data-testid="reason"]')).toBeNull();
    expect(document.querySelector('[data-testid="policy"]')).toBeNull();
    expect(document.querySelector('[data-testid="diff"]')).toBeNull();
  });

  it('hides the impact column when no row has a note', async () => {
    await open(TERMINATE);
    expect(document.querySelector('[data-testid="diff"] thead')?.textContent).not.toContain(
      'Impact',
    );
  });

  it('returns the typed note with the approval', async () => {
    const { loader, closed } = await open(DISCOUNT);
    await (await loader.getHarness(MatInputHarness)).setValue('  Go ahead, but only this once  ');
    await (await loader.getHarness(MatButtonHarness.with({ text: 'Approve' }))).click();
    await vi.waitFor(() =>
      expect(closed).toHaveBeenCalledExactlyOnceWith({
        approved: true,
        note: 'Go ahead, but only this once',
      }),
    );
  });

  it('returns a rejection without a note when none was typed', async () => {
    const { loader, closed } = await open(DISCOUNT);
    await (await loader.getHarness(MatButtonHarness.with({ text: 'Reject' }))).click();
    await vi.waitFor(() => expect(closed).toHaveBeenCalledExactlyOnceWith({ approved: false }));
  });

  it('puts initial focus on Reject for a critical request', async () => {
    visibleToFocusTrap();
    const { loader } = await open(TERMINATE);
    const reject = await loader.getHarness(MatButtonHarness.with({ text: 'Reject' }));
    await vi.waitFor(async () => expect(await reject.isFocused()).toBe(true));
    expect(document.querySelector('[data-testid="risk-badge"]')?.textContent).toContain(
      'Critical action',
    );
  });

  it('focuses the note field, not Reject, for a merely high-impact request', async () => {
    visibleToFocusTrap();
    const { loader } = await open(DISCOUNT);
    const note = await loader.getHarness(MatInputHarness);
    await vi.waitFor(async () => expect(await note.isFocused()).toBe(true));
    const reject = await loader.getHarness(MatButtonHarness.with({ text: 'Reject' }));
    expect(await reject.isFocused()).toBe(false);
  });

  it('cannot be dismissed with Escape or a backdrop click', async () => {
    const { dialog, closed } = await open(DISCOUNT);
    await dialog.close();
    document.querySelector<HTMLElement>('.cdk-overlay-backdrop')?.click();
    expect(closed).not.toHaveBeenCalled();
    expect(document.querySelector('app-approval-dialog')).not.toBeNull();
  });

  it('is an alertdialog with an accessible name and passes axe', async () => {
    await open(DISCOUNT);
    const container = document.querySelector('mat-dialog-container');
    expect(container?.getAttribute('role')).toBe('alertdialog');
    expect(container?.getAttribute('aria-labelledby')).toBeTruthy();
    await expectNoA11yViolations(document.querySelector<HTMLElement>('.cdk-overlay-container')!);
  });
});
