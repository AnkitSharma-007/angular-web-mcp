import type { ApprovalRequest, HumanApprovalGate } from './approval-gate';
import { NO_GATE_NOTE, requireApproval } from './with-human-approval';

const REQUEST: ApprovalRequest = { toolName: 'probe', risk: 'high', summary: 'Do it' };
const signal = new AbortController().signal;

function gate(decision: { approved: boolean; note?: string }): HumanApprovalGate {
  return { pending: (() => null) as never, request: vi.fn().mockResolvedValue(decision) };
}

describe('requireApproval', () => {
  it('returns null when the human approves, and forwards the request and signal', async () => {
    const approving = gate({ approved: true });
    expect(await requireApproval(approving, REQUEST, signal)).toBeNull();
    expect(approving.request).toHaveBeenCalledExactlyOnceWith(REQUEST, signal);
  });

  it('turns a rejection into a result and keeps the note', async () => {
    expect(await requireApproval(gate({ approved: false, note: 'no' }), REQUEST, signal)).toEqual({
      status: 'rejected_by_human',
      note: 'no',
    });
  });

  it('omits the note when there is none', async () => {
    expect(await requireApproval(gate({ approved: false }), REQUEST, signal)).toEqual({
      status: 'rejected_by_human',
    });
  });

  it('rejects when there is no gate at all (fail-safe)', async () => {
    expect(await requireApproval(null, REQUEST, signal)).toEqual({
      status: 'rejected_by_human',
      note: NO_GATE_NOTE,
    });
  });
});
