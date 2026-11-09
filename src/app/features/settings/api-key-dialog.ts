import { Component, inject, signal } from '@angular/core';
import { form, FormField, FormRoot, validate } from '@angular/forms/signals';
import { MatButton } from '@angular/material/button';
import {
  MatDialogActions,
  MatDialogClose,
  MatDialogContent,
  MatDialogRef,
  MatDialogTitle,
} from '@angular/material/dialog';
import { MatFormField, MatLabel } from '@angular/material/form-field';
import { MatIcon } from '@angular/material/icon';
import { MatInput } from '@angular/material/input';
import type { GeminiModelId } from '../../mcp/agent/gemini/gemini-models';
import { FieldErrors } from '../proposal/field-errors';
import { ModelPicker } from './model-picker';
import { SettingsStore } from './settings-store';

export const API_KEY_URL = 'https://aistudio.google.com/apikey';

@Component({
  selector: 'app-api-key-dialog',
  imports: [
    FieldErrors,
    FormField,
    FormRoot,
    MatButton,
    MatDialogActions,
    MatDialogClose,
    MatDialogContent,
    MatDialogTitle,
    MatFormField,
    MatIcon,
    MatInput,
    MatLabel,
    ModelPicker,
  ],
  templateUrl: './api-key-dialog.html',
})
export class ApiKeyDialog {
  protected readonly settings = inject(SettingsStore);
  private readonly dialogRef = inject<MatDialogRef<ApiKeyDialog, boolean>>(MatDialogRef);

  protected readonly keyUrl = API_KEY_URL;
  protected readonly selectedModel = signal<GeminiModelId>(this.settings.model());
  protected readonly entry = signal({
    apiKey: this.settings.apiKey(),
    remember: this.settings.remember(),
  });

  protected readonly entryForm = form(
    this.entry,
    (path) => {
      validate(path.apiKey, ({ value }) =>
        value().trim() === ''
          ? { kind: 'required', message: 'Enter your Gemini API key' }
          : undefined,
      );
    },
    {
      submission: {
        action: async () => {
          const { apiKey, remember } = this.entry();
          this.settings.saveKey(apiKey, remember);
          this.settings.setModel(this.selectedModel());
          this.dialogRef.close(true);
          return undefined;
        },
      },
    },
  );

  protected forget(): void {
    this.settings.forgetKey();
    this.entry.set({ apiKey: '', remember: false });
  }
}
