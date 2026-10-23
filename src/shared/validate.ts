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

/**
 * P1a: enforce the schema's size/range ceilings — `maximum`/`minimum` on
 * numbers, `maxLength` on strings, `maxItems` on arrays — wherever they are
 * declared, including nested object properties and array item schemas.
 *
 * This runs BEFORE dispatch so an absurd argument (a 10-minute wait, 99
 * navigate retries, a 500-URL batch) is rejected as invalid-args instead of
 * locking the shared page past the MCP client's ~60s timeout — the failure
 * mode behind the Claude tool_use/tool_result pairing error. Only ceilings
 * are enforced here (no nested type/enum checks), so nothing that was valid
 * before can be newly rejected unless it exceeds a declared ceiling.
 */
function validateRanges(value: unknown, schema: any, path: string, errors: string[]): void {
  if (schema === undefined || schema === null || value === undefined || value === null) return;

  if (typeof value === 'number') {
    if (typeof schema.maximum === 'number' && value > schema.maximum) {
      errors.push(`${path}: must be <= ${schema.maximum} (schema ceiling; got ${value})`);
    }
    if (typeof schema.minimum === 'number' && value < schema.minimum) {
      errors.push(`${path}: must be >= ${schema.minimum} (got ${value})`);
    }
  }
  if (typeof value === 'string' && typeof schema.maxLength === 'number' && value.length > schema.maxLength) {
    errors.push(`${path}: exceeds maxLength ${schema.maxLength} (got ${value.length} characters)`);
  }
  if (Array.isArray(value)) {
    if (typeof schema.maxItems === 'number' && value.length > schema.maxItems) {
      errors.push(`${path}: exceeds maxItems ${schema.maxItems} (got ${value.length} items)`);
    }
    if (schema.items) {
      value.forEach((item, i) => validateRanges(item, schema.items, `${path}[${i}]`, errors));
    }
  }
  if (isPlainObject(value) && schema.properties) {
    for (const [key, subSchema] of Object.entries(schema.properties)) {
      if ((value as Record<string, unknown>)[key] !== undefined) {
        validateRanges((value as Record<string, unknown>)[key], subSchema, `${path}.${key}`, errors);
      }
    }
  }
}

function validateValue(value: unknown, schema: any, path: string, errors: string[]): void {
  if (schema === undefined || schema === null) return;
  const type = schema.type;

  // P1a ceilings first — they apply regardless of which type branch follows.
  validateRanges(value, schema, path, errors);

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