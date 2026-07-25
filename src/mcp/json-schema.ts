import { z } from 'zod';

/**
 * Minimal Zod to JSON Schema conversion.
 *
 * Hand-rolled rather than pulling in another dependency: the tool schemas here use
 * a small, known subset of Zod, and MCP only needs object-shaped input schemas with
 * types, enums, descriptions and a required list.
 */
export function zodToJsonSchema(schema: z.ZodTypeAny): Record<string, unknown> {
  const converted = convert(schema);
  // MCP requires the top level to be an object schema.
  if (converted.type !== 'object') {
    return { type: 'object', properties: {}, additionalProperties: false };
  }
  return converted;
}

function unwrap(schema: z.ZodTypeAny): {
  inner: z.ZodTypeAny;
  optional: boolean;
  description?: string;
  defaultValue?: unknown;
} {
  let current = schema;
  let optional = false;
  let description: string | undefined;
  let defaultValue: unknown;

  // Peel optional/default/nullable/describe wrappers.
  for (let i = 0; i < 10; i++) {
    const def = (current as unknown as { _def: Record<string, unknown> })._def;
    description ??= (def?.description as string | undefined) ?? undefined;

    if (current instanceof z.ZodOptional) {
      optional = true;
      current = current.unwrap();
      continue;
    }
    if (current instanceof z.ZodNullable) {
      current = current.unwrap();
      continue;
    }
    if (current instanceof z.ZodDefault) {
      optional = true;
      defaultValue = (def.defaultValue as () => unknown)?.();
      current = (def.innerType as z.ZodTypeAny);
      continue;
    }
    break;
  }

  return { inner: current, optional, description, defaultValue };
}

function convert(schema: z.ZodTypeAny): Record<string, any> {
  const { inner, description, defaultValue } = unwrap(schema);
  const base: Record<string, any> = {};
  if (description) base.description = description;
  if (defaultValue !== undefined) base.default = defaultValue;

  if (inner instanceof z.ZodString) return { ...base, type: 'string' };
  if (inner instanceof z.ZodNumber) {
    const checks = (inner as unknown as { _def: { checks?: { kind: string; value: number }[] } })._def
      .checks;
    const out: Record<string, any> = { ...base, type: 'number' };
    for (const c of checks ?? []) {
      if (c.kind === 'int') out.type = 'integer';
      if (c.kind === 'min') out.minimum = c.value;
      if (c.kind === 'max') out.maximum = c.value;
    }
    return out;
  }
  if (inner instanceof z.ZodBoolean) return { ...base, type: 'boolean' };
  if (inner instanceof z.ZodEnum) {
    return { ...base, type: 'string', enum: [...(inner.options as string[])] };
  }
  if (inner instanceof z.ZodArray) {
    return { ...base, type: 'array', items: convert(inner.element as z.ZodTypeAny) };
  }
  if (inner instanceof z.ZodObject) {
    const shape = inner.shape as Record<string, z.ZodTypeAny>;
    const properties: Record<string, unknown> = {};
    const required: string[] = [];

    for (const [key, value] of Object.entries(shape)) {
      properties[key] = convert(value);
      const { optional } = unwrap(value);
      if (!optional) required.push(key);
    }

    const out: Record<string, any> = { ...base, type: 'object', properties };
    if (required.length > 0) out.required = required;
    return out;
  }
  if (inner instanceof z.ZodAny || inner instanceof z.ZodUnknown) return { ...base };

  // Anything else degrades to an unconstrained value rather than failing.
  return { ...base };
}
