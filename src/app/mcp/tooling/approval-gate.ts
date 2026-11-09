import { InjectionToken, type Signal } from '@angular/core';

export type ApprovalRisk = 'high' | 'critical';

export interface ApprovalDiffRow {
  label: string;
  field: string;
  before: string;
  after: string;
  note?: string;
}

export interface ApprovalRequest {
  toolName: string;
  risk: ApprovalRisk;
  summary: string;
  reason?: string;
  policy?: string[];
  diff?: ApprovalDiffRow[];
  details?: unknown;
}

export interface ApprovalDecision {
  approved: boolean;
  note?: string;
}

export interface HumanApprovalGate {
  readonly pending: Signal<ApprovalRequest | null>;
  request(request: ApprovalRequest, signal: AbortSignal): Promise<ApprovalDecision>;
}

export const HUMAN_APPROVAL_GATE = new InjectionToken<HumanApprovalGate>('HUMAN_APPROVAL_GATE');
