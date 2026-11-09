import { ToolInputError } from './tool-errors';

describe('ToolInputError', () => {
  it('carries the tool name and field paths in its message', () => {
    const error = ToolInputError.fromIssues('searchDeals', [
      { path: 'limit', message: 'must be <= 25' },
      { path: 'stages[0]', message: 'must be one of "proposal"' },
    ]);
    expect(error).toBeInstanceOf(Error);
    expect(error.name).toBe('ToolInputError');
    expect(error.message).toBe(
      'Invalid input for searchDeals: limit: must be <= 25; stages[0]: must be one of "proposal"',
    );
    expect(error.issues).toHaveLength(2);
  });

  it('defaults to no issues', () => {
    expect(new ToolInputError('Unknown deal D-9999').issues).toEqual([]);
  });
});
