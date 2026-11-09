import type { ApprovalRequest, HumanApprovalGate } from './approval-gate';

export const NO_GATE_NOTE = 'no human approval gate is available';

export interface Rejection {
  status: 'rejected_by_human';
  note?: string;
}

/** Asks the gate; returns a rejection result, or null when approved. A missing gate rejects (fail-safe). */
export async function requireApproval(
  gate: HumanApprovalGate | null,
  request: ApprovalRequest,
  signal: AbortSignal,
): Promise<Rejection | null> {
  const decision = gate
    ? await gate.request(request, signal)
    : { approved: false, note: NO_GATE_NOTE };
  return decision.approved
    ? null
    : { status: 'rejected_by_human', ...(decision.note !== undefined && { note: decision.note }) };
}
