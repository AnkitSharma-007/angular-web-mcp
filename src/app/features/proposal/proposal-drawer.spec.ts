import { signal } from '@angular/core';
import { TestBed, type ComponentFixture } from '@angular/core/testing';
import { provideExperimentalWebMcpForms } from '@angular/forms/signals';
import { provideRouter } from '@angular/router';
import { expectNoA11yViolations } from '../../../testing/a11y';
import { useFakeModelContext } from '../../../testing/test-providers';
import { PROPOSAL_KEYS } from '../../core/models/proposal';
import {
  HUMAN_APPROVAL_GATE,
  type ApprovalDecision,
  type ApprovalRequest,
} from '../../mcp/tooling/approval-gate';
import { DashboardShell } from '../dashboard/dashboard-shell';
import { DashboardUiStore } from '../dashboard/data/dashboard-ui-store';
import { DealsStore } from '../dashboard/data/deals-store';
import { AGENT_GLOW_MS, ProposalDrawer } from './proposal-drawer';
import { PROPOSAL_TOOL_NAME } from './proposal-form';
import { ProposalsStore } from './proposals-store';

const VALID_ARGS = {
  dealId: 'D-1001',
  clientName: 'Konkan Freight',
  contactEmail: 'procurement@konkan.example',
  productTier: 'Enterprise',
  seats: 250,
  termMonths: 24,
  discountPct: 10,
  startDate: '2027-01-01',
  lineItems: ['Platform license', 'Premium support'],
};

function textOf(result: unknown): string {
  return (result as { content: { text: string }[] }).content[0]?.text ?? '';
}

describe('ProposalDrawer', () => {
  const registry = useFakeModelContext();
  const request =
    vi.fn<(request: ApprovalRequest, signal: AbortSignal) => Promise<ApprovalDecision>>();

  beforeEach(() => {
    request.mockReset();
    TestBed.configureTestingModule({
      providers: [
        DealsStore,
        DashboardUiStore,
        ProposalsStore,
        provideExperimentalWebMcpForms(),
        provideRouter([]),
        { provide: HUMAN_APPROVAL_GATE, useValue: { pending: signal(null), request } },
      ],
    });
  });

  afterEach(() => vi.useRealTimers());

  async function mount(dealId?: string) {
    if (dealId) {
      TestBed.inject(DashboardUiStore).openProposal(dealId);
    }
    const fixture = TestBed.createComponent(ProposalDrawer);
    fixture.detectChanges();
    await vi.waitFor(() => expect(registry.current.toolNames()).toContain(PROPOSAL_TOOL_NAME));
    const root = fixture.nativeElement as HTMLElement;
    const input = (field: string) =>
      root.querySelector<HTMLInputElement>(`[data-field="${field}"]`)!;
    const run = async (args: Record<string, unknown>) => {
      const result = textOf(await registry.current.executeTool(PROPOSAL_TOOL_NAME, args));
      fixture.detectChanges();
      await fixture.whenStable();
      return result;
    };
    const type = (field: string, value: string) => {
      const element = input(field);
      element.value = value;
      element.dispatchEvent(new Event('input', { bubbles: true }));
      fixture.detectChanges();
    };
    return {
      fixture,
      root,
      input,
      run,
      type,
      proposals: TestBed.inject(ProposalsStore),
      ui: TestBed.inject(DashboardUiStore),
      testId: (id: string) => root.querySelector<HTMLElement>(`[data-testid="${id}"]`),
    };
  }

  describe('tool lifecycle', () => {
    it('registers draftDealProposal with every field required and unregisters on destroy', async () => {
      const { fixture } = await mount();
      const tool = registry.current.getTools().find((t) => t.name === PROPOSAL_TOOL_NAME);
      expect(tool?.inputSchema).toMatchObject({
        type: 'object',
        additionalProperties: false,
        required: expect.arrayContaining([...PROPOSAL_KEYS]),
      });
      expect(tool?.description).toContain('1st of a month');

      fixture.destroy();
      expect(registry.current.toolNames()).not.toContain(PROPOSAL_TOOL_NAME);
    });

    it('fires toolchange when the tool appears and again when it goes away', async () => {
      const listener = vi.fn();
      registry.current.addEventListener('toolchange', listener);
      const { fixture } = await mount();
      const afterMount = listener.mock.calls.length;
      expect(afterMount).toBeGreaterThan(0);
      fixture.destroy();
      expect(listener.mock.calls.length).toBe(afterMount + 1);
    });

    it('comes and goes with the proposalOpen flag in the dashboard shell', async () => {
      const shell: ComponentFixture<DashboardShell> = TestBed.createComponent(DashboardShell);
      const ui = TestBed.inject(DashboardUiStore);
      shell.detectChanges();
      expect(shell.nativeElement.querySelector('app-proposal-drawer')).toBeNull();

      ui.openProposal('D-1001');
      shell.detectChanges();
      expect(shell.nativeElement.querySelector('app-proposal-drawer')).not.toBeNull();
      await vi.waitFor(() => expect(registry.current.toolNames()).toContain(PROPOSAL_TOOL_NAME));

      ui.closeProposal();
      shell.detectChanges();
      expect(shell.nativeElement.querySelector('app-proposal-drawer')).toBeNull();
      expect(registry.current.toolNames()).not.toContain(PROPOSAL_TOOL_NAME);
    });
  });

  describe('agent fill', () => {
    it('fills the DOM inputs, highlights them, and saves a draft', async () => {
      const { run, input, root, proposals, testId } = await mount();
      expect(await run(VALID_ARGS)).toBe('Form submitted successfully.');

      expect(input('dealId').value).toBe('D-1001');
      expect(input('clientName').value).toBe('Konkan Freight');
      expect(input('productTier').value).toBe('Enterprise');
      expect(input('seats').value).toBe('250');
      expect(input('startDate').value).toBe('2027-01-01');
      expect(root.querySelectorAll('[data-field="lineItems"]')).toHaveLength(2);
      expect(root.querySelectorAll('mat-form-field[data-agent-filled]').length).toBeGreaterThan(5);

      expect(proposals.entities()).toHaveLength(1);
      expect(proposals.latest()).toMatchObject({ id: 'P-0001', seats: 250, termMonths: 24 });
      expect(testId('saved')?.textContent).toContain('Draft P-0001 saved for Konkan Freight');
    });

    it('drops the highlight after the glow duration', async () => {
      const { run, root, fixture } = await mount();
      vi.useFakeTimers();
      await run(VALID_ARGS);
      expect(root.querySelector('[data-agent-filled]')).not.toBeNull();

      vi.advanceTimersByTime(AGENT_GLOW_MS);
      fixture.detectChanges();
      expect(root.querySelector('[data-agent-filled]')).toBeNull();
    });

    it('does not highlight what a person types', async () => {
      const { type, root } = await mount();
      type('clientName', 'Typed By Hand');
      expect(root.querySelector('[data-agent-filled]')).toBeNull();
    });

    it('returns the failing field paths so the agent can retry, then accepts the fix', async () => {
      const { run, proposals, testId } = await mount();
      const failed = await run({ ...VALID_ARGS, startDate: '2026-12-15' });
      expect(failed).toContain('Form submission failed');
      expect(failed).toContain('startDate: Start date must be the 1st of a month');
      expect(proposals.entities()).toHaveLength(0);
      expect(testId('problems')?.textContent).toContain('Start date');

      expect(await run(VALID_ARGS)).toBe('Form submitted successfully.');
      expect(proposals.entities()).toHaveLength(1);
      expect(testId('problems')).toBeNull();
    });

    it('lists every problem at once for several bad fields', async () => {
      const { run } = await mount();
      const failed = await run({
        ...VALID_ARGS,
        dealId: 'D-9999',
        contactEmail: 'nope',
        seats: 0,
      });
      expect(failed).toContain('dealId: No deal with ID "D-9999"');
      expect(failed).toContain('contactEmail: Enter a valid email address');
      expect(failed).toContain('seats: At least 1 seat');
    });

    it('rejects a Starter proposal above 1000 seats as a submission error', async () => {
      const { run, proposals } = await mount();
      const failed = await run({ ...VALID_ARGS, productTier: 'Starter', seats: 2000 });
      expect(failed).toContain('seats: Starter supports at most 1000 seats');
      expect(request).not.toHaveBeenCalled();
      expect(proposals.entities()).toHaveLength(0);
    });
  });

  describe('discount approval', () => {
    it('does not ask the gate for a discount of 15% or less', async () => {
      const { run } = await mount();
      await run({ ...VALID_ARGS, discountPct: 15 });
      expect(request).not.toHaveBeenCalled();
    });

    it('asks the gate above 15% and saves once approved', async () => {
      request.mockResolvedValue({ approved: true });
      const { run, proposals } = await mount();
      expect(await run({ ...VALID_ARGS, discountPct: 20 })).toBe('Form submitted successfully.');

      expect(request).toHaveBeenCalledTimes(1);
      const [asked, signal] = request.mock.calls[0]!;
      expect(asked).toMatchObject({ toolName: PROPOSAL_TOOL_NAME, risk: 'high' });
      expect(asked.policy?.[0]).toContain('20%');
      expect(asked.diff?.[0]).toMatchObject({ field: 'Discount', before: '5%', after: '20%' });
      expect(signal.aborted).toBe(false);
      expect(proposals.entities()).toHaveLength(1);
    });

    it('saves nothing and tells the agent when the human rejects', async () => {
      request.mockResolvedValue({ approved: false, note: 'too deep' });
      const { run, proposals } = await mount();
      const failed = await run({ ...VALID_ARGS, discountPct: 20 });
      expect(failed).toContain('discountPct: A human rejected the 20% discount: too deep');
      expect(proposals.entities()).toHaveLength(0);
    });

    it('rejects safely when no gate is provided', async () => {
      TestBed.resetTestingModule();
      TestBed.configureTestingModule({
        providers: [DealsStore, DashboardUiStore, ProposalsStore, provideExperimentalWebMcpForms()],
      });
      const { run, proposals } = await mount();
      const failed = await run({ ...VALID_ARGS, discountPct: 20 });
      expect(failed).toContain('A human rejected the 20% discount');
      expect(proposals.entities()).toHaveLength(0);
    });

    it('aborts a pending approval when the drawer is destroyed', async () => {
      request.mockReturnValue(new Promise(() => undefined));
      const { run, fixture } = await mount();
      void run({ ...VALID_ARGS, discountPct: 20 });
      await vi.waitFor(() => expect(request).toHaveBeenCalled());
      fixture.destroy();
      expect(request.mock.calls[0]![1].aborted).toBe(true);
    });
  });

  describe('person at the keyboard', () => {
    it('prefills the client from the deal the drawer was opened for', async () => {
      const { input } = await mount('D-1001');
      expect(input('dealId').value).toBe('D-1001');
      expect(input('clientName').value).toBe('Konkan Freight');
    });

    it('re-seeds the form when it is opened for another deal', async () => {
      const { input, ui, fixture } = await mount('D-1001');
      ui.openProposal('D-1002');
      fixture.detectChanges();
      expect(input('dealId').value).toBe('D-1002');
    });

    it('saves from the Save draft button once valid', async () => {
      const { type, testId, fixture, proposals } = await mount('D-1001');
      type('startDate', '2027-02-01');
      testId('save')!.click();
      await vi.waitFor(() => {
        fixture.detectChanges();
        expect(testId('saved')).not.toBeNull();
      });
      expect(proposals.latest()).toMatchObject({
        startDate: '2027-02-01',
        clientName: 'Konkan Freight',
      });
    });

    it('shows field errors and a banner when saving an incomplete form', async () => {
      const { testId, fixture, root, proposals } = await mount();
      testId('save')!.click();
      await vi.waitFor(() => {
        fixture.detectChanges();
        expect(testId('problems')).not.toBeNull();
      });
      expect(root.textContent).toContain('Deal ID is required');
      expect(proposals.entities()).toHaveLength(0);
    });

    it('adds and removes line items', async () => {
      const { testId, root, fixture } = await mount();
      testId('add-line-item')!.click();
      fixture.detectChanges();
      expect(root.querySelectorAll('[data-field="lineItems"]')).toHaveLength(2);
      testId('remove-line-item')!.click();
      fixture.detectChanges();
      expect(root.querySelectorAll('[data-field="lineItems"]')).toHaveLength(1);
    });

    it('closes from the close button and from Escape', async () => {
      const { ui, testId, root } = await mount('D-1001');
      expect(ui.proposalOpen()).toBe(true);
      testId('close')!.click();
      expect(ui.proposalOpen()).toBe(false);

      ui.openProposal('D-1001');
      root.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
      expect(ui.proposalOpen()).toBe(false);
    });

    it('moves focus to the drawer heading when it opens', async () => {
      await mount();
      expect(document.activeElement?.id).toBe('proposal-title');
    });

    it('has no accessibility violations, empty or after an agent fill', async () => {
      const { root, run } = await mount();
      await expectNoA11yViolations(root);
      await run({ ...VALID_ARGS, startDate: '2026-12-15' });
      await expectNoA11yViolations(root);
    });
  });
});
