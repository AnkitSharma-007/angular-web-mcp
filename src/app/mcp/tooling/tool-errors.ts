import { formatIssues, type ValidationIssue } from '../schema/validate-args';

export class ToolInputError extends Error {
  override readonly name = 'ToolInputError';

  constructor(
    message: string,
    readonly issues: readonly ValidationIssue[] = [],
  ) {
    super(message);
  }

  static fromIssues(toolName: string, issues: readonly ValidationIssue[]): ToolInputError {
    return new ToolInputError(`Invalid input for ${toolName}: ${formatIssues(issues)}`, issues);
  }
}
