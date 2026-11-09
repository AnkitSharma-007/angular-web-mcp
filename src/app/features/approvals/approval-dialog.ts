import { Component, computed, inject, signal } from '@angular/core';
import { form, FormField } from '@angular/forms/signals';
import { MatButton } from '@angular/material/button';
import {
  MAT_DIALOG_DATA,
  MatDialogActions,
  MatDialogContent,
  MatDialogRef,
  MatDialogTitle,
} from '@angular/material/dialog';
import { MatFormField, MatLabel } from '@angular/material/form-field';
import { MatIcon } from '@angular/material/icon';
import { MatInput } from '@angular/material/input';
import type { ApprovalDecision, ApprovalRequest } from '../../mcp/tooling/approval-gate';

@Component({
  selector: 'app-approval-dialog',
  imports: [
    FormField,
    MatButton,
    MatDialogActions,
    MatDialogContent,
    MatDialogTitle,
    MatFormField,
    MatIcon,
    MatInput,
    MatLabel,
  ],
  templateUrl: './approval-dialog.html',
})
export class ApprovalDialog {
  protected readonly request = inject<ApprovalRequest>(MAT_DIALOG_DATA);
  private readonly dialogRef = inject<MatDialogRef<ApprovalDialog, ApprovalDecision>>(MatDialogRef);

  protected readonly critical = this.request.risk === 'critical';
  protected readonly riskLabel = this.critical ? 'Critical action' : 'High-impact action';
  protected readonly noteModel = signal({ note: '' });
  protected readonly noteForm = form(this.noteModel);
  protected readonly hasDiffNotes = computed(() =>
    (this.request.diff ?? []).some((row) => row.note !== undefined),
  );

  protected approve(): void {
    this.dialogRef.close(this.decision(true));
  }

  protected reject(): void {
    this.dialogRef.close(this.decision(false));
  }

  private decision(approved: boolean): ApprovalDecision {
    const note = this.noteModel().note.trim();
    return { approved, ...(note && { note }) };
  }
}
