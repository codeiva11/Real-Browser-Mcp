/**
 * Lightweight runtime parameter validation against tool input schemas.
 *
 * Catches the classic failure mode where the LLM omits required params
 * (e.g. `navigate` without `url`, `execute_js` without `code`) and the server
 * returns a confusing raw error — or worse, silently proceeds with
 * `undefined`. Validation is strict on missing required string fields and
 * never mutates the incoming args.
 */

export interface ValidationResult {
  valid: boolean;
  errors: string[];
}

const STRING_TYPES = new Set(['string']);

function isPlainObject(v: unknown): boolean {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function validateValue(value: unknown, schema: any, path: string, errors: string[]): void {
  if (schema === undefined || schema === null) return;
  const type = schema.type;

  if (schema.enum && value !== undefined && value !== null) {
    if (!schema.enum.includes(value)) {
      errors.push(`${path}: must be one of ${schema.enum.map((e: unknown) => JSON.stringify(e)).join(', ')}`);
      return;
    }
  }

  if (type === 'array') {
    if (value !== undefined && value !== null && !Array.isArray(value)) {
      errors.push(`${path}: must be an array`);
    }
    return;
  }

  if (type === 'object') {
    if (value !== undefined && value !== null && !isPlainObject(value)) {
      errors.push(`${path}: must be an object`);
    }
    return;
  }

  if (STRING_TYPES.has(type) && value !== undefined && value !== null && typeof value !== 'string') {
    errors.push(`${path}: must be a string`);
    return;
  }

  if (type === 'number' && value !== undefined && value !== null && typeof value !== 'number') {
    errors.push(`${path}: must be a number`);
    return;
  }

  if (type === 'boolean' && value !== undefined && value !== null && typeof value !== 'boolean') {
    errors.push(`${path}: must be a boolean`);
  }
}

/**
 * Validate args against a tool's inputSchema. Returns the list of errors.
 * Empty result means valid.
 */
export function validateToolArgs(inputSchema: any, args: Record<string, unknown>): ValidationResult {
  const errors: string[] = [];
  if (!inputSchema || !isPlainObject(inputSchema)) {
    return { valid: true, errors };
  }

  const properties: Record<string, any> = inputSchema.properties || {};

  // anyOf: at least one of the listed required-groups must be satisfied
  // (used by click/type for "selector OR annotationId").
  if (Array.isArray(inputSchema.anyOf)) {
    const satisfied = inputSchema.anyOf.some((group: any) =>
      Array.isArray(group.required) && group.required.every((key: string) => {
        const value = args[key];
        return value !== undefined && value !== null && value !== '';
      })
    );
    if (!satisfied) {
      const groups = inputSchema.anyOf
        .map((g: any) => (Array.isArray(g.required) ? g.required.join(' + ') : ''))
        .filter(Boolean)
        .join(' OR ');
      errors.push(`Provide at least one of: ${groups}`);
    }
  }

  // Missing required fields
  if (Array.isArray(inputSchema.required)) {
    for (const req of inputSchema.required) {
      const value = args[req];
      if (value === undefined || value === null || value === '') {
        errors.push(`Missing required parameter: ${req}`);
      }
    }
  }

  // Type/enum checking on provided values
  for (const [key, schema] of Object.entries(properties)) {
    if (args[key] === undefined) continue;
    validateValue(args[key], schema as any, key, errors);
  }

  return { valid: errors.length === 0, errors };
}

/**
 * Validate args and return a standardized error result (shape the server
 * renders as isError) when validation fails.
 */
export function invalidArgsResult(toolName: string, result: ValidationResult): { success: false; error: string } {
  return {
    success: false,
    error: `${toolName}: invalid parameters — ${result.errors.join('; ')}`,
  };
}