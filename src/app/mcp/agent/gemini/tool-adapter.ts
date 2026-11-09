import type { RegistryToolInfo } from '../../registry/model-context';
import type { ToolCallResult } from '../mcp-tool-gateway';
import type { GenAiFunctionDeclaration, GenAiFunctionCall, GenAiPart } from './genai-client';

const EMPTY_SCHEMA = { type: 'object', properties: {} } as const;

function hasContent(schema: object | undefined): schema is object {
  return schema !== undefined && Object.keys(schema).length > 0;
}

export function toFunctionDeclarations(
  tools: readonly RegistryToolInfo[],
): GenAiFunctionDeclaration[] {
  return tools.map((tool) => ({
    name: tool.name,
    description: tool.description,
    parametersJsonSchema: hasContent(tool.inputSchema) ? tool.inputSchema : EMPTY_SCHEMA,
  }));
}

export function toFunctionResponse(call: GenAiFunctionCall, result: ToolCallResult): GenAiPart {
  return {
    functionResponse: {
      ...(call.id !== undefined && { id: call.id }),
      name: result.name,
      response: result.ok ? { output: result.result } : { error: result.result },
    },
  };
}
