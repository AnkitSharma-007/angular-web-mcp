import { validateArgs, type JsonSchema } from '../schema/validate-args';
import { ToolInputError } from './tool-errors';

export function validateToolArgs(toolName: string, schema: JsonSchema, args: unknown): void {
  const issues = validateArgs(schema, args ?? {});
  if (issues.length > 0) throw ToolInputError.fromIssues(toolName, issues);
}
