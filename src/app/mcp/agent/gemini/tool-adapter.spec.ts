import type { RegistryToolInfo } from '../../registry/model-context';
import type { ToolCallResult } from '../mcp-tool-gateway';
import { toFunctionDeclarations, toFunctionResponse } from './tool-adapter';

describe('toFunctionDeclarations', () => {
  it('passes name, description and the input schema through unchanged', () => {
    const inputSchema = {
      type: 'object',
      properties: { dealId: { type: 'string', pattern: '^D-\\d{4}$' } },
      required: ['dealId'],
      additionalProperties: false,
    } as const;
    const tools: RegistryToolInfo[] = [
      { name: 'getDealDetails', description: 'Read one deal', inputSchema },
    ];
    const [declaration] = toFunctionDeclarations(tools);
    expect(declaration).toEqual({
      name: 'getDealDetails',
      description: 'Read one deal',
      parametersJsonSchema: inputSchema,
    });
    expect(declaration?.parametersJsonSchema).toBe(inputSchema);
  });

  it('gives a tool without a schema a default empty object schema', () => {
    const [declaration] = toFunctionDeclarations([{ name: 'ping', description: 'Ping' }]);
    expect(declaration?.parametersJsonSchema).toEqual({ type: 'object', properties: {} });
  });

  it('treats an empty schema object like a missing one', () => {
    const [declaration] = toFunctionDeclarations([
      { name: 'ping', description: 'Ping', inputSchema: {} },
    ]);
    expect(declaration?.parametersJsonSchema).toEqual({ type: 'object', properties: {} });
  });

  it('keeps the registry order', () => {
    const names = toFunctionDeclarations([
      { name: 'b', description: '' },
      { name: 'a', description: '' },
    ]).map((declaration) => declaration.name);
    expect(names).toEqual(['b', 'a']);
  });

  it('returns nothing for no tools', () => {
    expect(toFunctionDeclarations([])).toEqual([]);
  });
});

describe('toFunctionResponse', () => {
  const ok: ToolCallResult = { name: 'searchDeals', ok: true, result: { total: 2 }, latencyMs: 4 };

  it('wraps a successful result as output and keeps the call id', () => {
    expect(toFunctionResponse({ id: 'c1', name: 'searchDeals' }, ok)).toEqual({
      functionResponse: { id: 'c1', name: 'searchDeals', response: { output: { total: 2 } } },
    });
  });

  it('wraps a failure as error', () => {
    const failed: ToolCallResult = { ...ok, ok: false, result: { error: 'Unknown tool' } };
    expect(toFunctionResponse({ id: 'c1' }, failed).functionResponse?.response).toEqual({
      error: { error: 'Unknown tool' },
    });
  });

  it('omits the id when the call had none', () => {
    expect(toFunctionResponse({}, ok).functionResponse).not.toHaveProperty('id');
  });
});
