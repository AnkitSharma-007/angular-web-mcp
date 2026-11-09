export type JsonSchemaType = 'string' | 'number' | 'integer' | 'boolean' | 'object' | 'array';

export interface JsonSchema {
  type?: JsonSchemaType;
  description?: string;
  properties?: Record<string, JsonSchema>;
  required?: readonly string[];
  additionalProperties?: boolean;
  enum?: readonly (string | number)[];
  minimum?: number;
  maximum?: number;
  minLength?: number;
  maxLength?: number;
  pattern?: string;
  items?: JsonSchema;
  minItems?: number;
  maxItems?: number;
}

export interface ValidationIssue {
  path: string;
  message: string;
}

export function validateArgs(schema: JsonSchema, value: unknown): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  check(schema, value, '', issues);
  return issues;
}

export function formatIssues(issues: readonly ValidationIssue[]): string {
  return issues.map(({ path, message }) => (path ? `${path}: ${message}` : message)).join('; ');
}

function check(schema: JsonSchema, value: unknown, path: string, issues: ValidationIssue[]): void {
  const fail = (message: string) => issues.push({ path, message });

  if (schema.type && !matchesType(schema.type, value)) {
    fail(`expected ${schema.type}, got ${describe(value)}`);
    return;
  }
  if (schema.enum && !schema.enum.includes(value as string | number)) {
    fail(`must be one of ${schema.enum.map((v) => JSON.stringify(v)).join(', ')}`);
  }
  if (typeof value === 'number') {
    if (schema.minimum !== undefined && value < schema.minimum) {
      fail(`must be >= ${schema.minimum}`);
    }
    if (schema.maximum !== undefined && value > schema.maximum) {
      fail(`must be <= ${schema.maximum}`);
    }
  }
  if (typeof value === 'string') {
    if (schema.minLength !== undefined && value.length < schema.minLength) {
      fail(`must be at least ${schema.minLength} characters`);
    }
    if (schema.maxLength !== undefined && value.length > schema.maxLength) {
      fail(`must be at most ${schema.maxLength} characters`);
    }
    if (schema.pattern !== undefined && !new RegExp(schema.pattern).test(value)) {
      fail(`must match ${schema.pattern}`);
    }
  }
  if (Array.isArray(value)) {
    if (schema.minItems !== undefined && value.length < schema.minItems) {
      fail(`must have at least ${schema.minItems} items`);
    }
    if (schema.maxItems !== undefined && value.length > schema.maxItems) {
      fail(`must have at most ${schema.maxItems} items`);
    }
    const itemSchema = schema.items;
    if (itemSchema) {
      value.forEach((item, index) => check(itemSchema, item, `${path}[${index}]`, issues));
    }
  }
  if (isRecord(value)) {
    checkObject(schema, value, path, issues);
  }
}

function checkObject(
  schema: JsonSchema,
  value: Record<string, unknown>,
  path: string,
  issues: ValidationIssue[],
): void {
  const properties = schema.properties ?? {};
  const child = (key: string) => (path ? `${path}.${key}` : key);

  for (const key of schema.required ?? []) {
    if (value[key] === undefined) {
      issues.push({ path: child(key), message: 'is required' });
    }
  }
  for (const [key, propertyValue] of Object.entries(value)) {
    const propertySchema = properties[key];
    if (propertySchema) {
      if (propertyValue !== undefined) {
        check(propertySchema, propertyValue, child(key), issues);
      }
    } else if (schema.additionalProperties === false) {
      issues.push({ path: child(key), message: 'is not an allowed property' });
    }
  }
}

function matchesType(type: JsonSchemaType, value: unknown): boolean {
  switch (type) {
    case 'string':
      return typeof value === 'string';
    case 'number':
      return typeof value === 'number' && Number.isFinite(value);
    case 'integer':
      return Number.isInteger(value);
    case 'boolean':
      return typeof value === 'boolean';
    case 'array':
      return Array.isArray(value);
    case 'object':
      return isRecord(value);
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function describe(value: unknown): string {
  if (value === null) return 'null';
  if (Array.isArray(value)) return 'array';
  return typeof value;
}
