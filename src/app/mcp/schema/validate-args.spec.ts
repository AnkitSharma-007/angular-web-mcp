import { formatIssues, validateArgs, type JsonSchema } from './validate-args';

const updatesSchema: JsonSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['updates', 'reason'],
  properties: {
    reason: { type: 'string', minLength: 3, maxLength: 200 },
    updates: {
      type: 'array',
      minItems: 1,
      maxItems: 2,
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['dealId', 'stage'],
        properties: {
          dealId: { type: 'string', pattern: '^D-\\d{4}$' },
          stage: { type: 'string', enum: ['proposal', 'negotiation'] },
        },
      },
    },
  },
};

describe('validateArgs', () => {
  it('accepts valid input', () => {
    const args = { reason: 'quarter end', updates: [{ dealId: 'D-1001', stage: 'proposal' }] };
    expect(validateArgs(updatesSchema, args)).toEqual([]);
  });

  it.each([
    ['string', 5, 'expected string, got number'],
    ['number', 'x', 'expected number, got string'],
    ['integer', 1.5, 'expected integer, got number'],
    ['boolean', 'true', 'expected boolean, got string'],
    ['array', {}, 'expected array, got object'],
    ['object', [], 'expected object, got array'],
    ['object', null, 'expected object, got null'],
  ] as const)('rejects a wrong type for %s', (type, value, message) => {
    expect(validateArgs({ type }, value)).toEqual([{ path: '', message }]);
  });

  it('rejects non-finite numbers', () => {
    expect(validateArgs({ type: 'number' }, Number.NaN)).toHaveLength(1);
  });

  it('reports missing required properties', () => {
    expect(validateArgs(updatesSchema, {})).toEqual([
      { path: 'updates', message: 'is required' },
      { path: 'reason', message: 'is required' },
    ]);
  });

  it('treats undefined values as missing', () => {
    const issues = validateArgs(updatesSchema, { reason: undefined, updates: undefined });
    expect(issues.map((i) => i.path)).toEqual(['updates', 'reason']);
  });

  it('rejects additional properties when disallowed and allows them otherwise', () => {
    expect(validateArgs(updatesSchema, { reason: 'abc', updates: [], extra: 1 })).toContainEqual({
      path: 'extra',
      message: 'is not an allowed property',
    });
    expect(validateArgs({ type: 'object' }, { anything: 1 })).toEqual([]);
  });

  it('validates enum, min/max and pattern', () => {
    const schema: JsonSchema = {
      type: 'object',
      properties: {
        stage: { enum: ['a', 'b'] },
        pct: { type: 'number', minimum: 0, maximum: 50 },
        id: { type: 'string', pattern: '^D-\\d{4}$' },
      },
    };
    const issues = validateArgs(schema, { stage: 'c', pct: 60, id: 'X-1' });
    expect(issues).toEqual([
      { path: 'stage', message: 'must be one of "a", "b"' },
      { path: 'pct', message: 'must be <= 50' },
      { path: 'id', message: 'must match ^D-\\d{4}$' },
    ]);
    expect(validateArgs(schema, { pct: -1 })).toEqual([{ path: 'pct', message: 'must be >= 0' }]);
  });

  it('validates string length', () => {
    expect(validateArgs(updatesSchema, { reason: 'ab', updates: [] })).toContainEqual({
      path: 'reason',
      message: 'must be at least 3 characters',
    });
    expect(
      validateArgs(updatesSchema, { reason: 'x'.repeat(201), updates: [] }).map((i) => i.message),
    ).toContain('must be at most 200 characters');
  });

  it('validates minItems and maxItems', () => {
    const base = { reason: 'abc' };
    expect(validateArgs(updatesSchema, { ...base, updates: [] })).toContainEqual({
      path: 'updates',
      message: 'must have at least 1 items',
    });
    const three = [1, 2, 3].map(() => ({ dealId: 'D-1001', stage: 'proposal' }));
    expect(validateArgs(updatesSchema, { ...base, updates: three })).toContainEqual({
      path: 'updates',
      message: 'must have at most 2 items',
    });
  });

  it('reports nested paths with array indexes', () => {
    const args = {
      reason: 'abc',
      updates: [
        { dealId: 'D-1001', stage: 'proposal' },
        { dealId: 'D-1002', stage: 'won' },
      ],
    };
    expect(validateArgs(updatesSchema, args)).toEqual([
      { path: 'updates[1].stage', message: 'must be one of "proposal", "negotiation"' },
    ]);
  });
});

describe('formatIssues', () => {
  it('joins issues and omits an empty path', () => {
    expect(
      formatIssues([
        { path: 'a.b', message: 'is required' },
        { path: '', message: 'expected object, got null' },
      ]),
    ).toBe('a.b: is required; expected object, got null');
  });
});
