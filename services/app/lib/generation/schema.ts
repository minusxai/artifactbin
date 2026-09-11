import { z } from "zod";
import { GENERATION_LIMITS } from "@artifactbin/contracts";

/** Deliberately bounded JSON Schema subset. Reject unknown keywords instead of
 * silently ignoring constraints, references, or provider-specific extensions. */
export function generationSchema(source: string): z.ZodType {
  const fail = (): never => {
    throw new Error(
      "Invalid generation schema: use bounded object, array, string, number, integer, boolean or null schemas",
    );
  };
  if (Buffer.byteLength(source) > GENERATION_LIMITS.schemaBytes) fail();
  let root: unknown;
  try {
    root = JSON.parse(source);
  } catch {
    fail();
  }
  const visit = (value: unknown, depth: number): void => {
    if (
      depth > 8 ||
      !value ||
      typeof value !== "object" ||
      Array.isArray(value)
    )
      fail();
    const s = value as Record<string, unknown>;
    const kinds: Record<string, string[]> = {
      object: ["properties", "required", "additionalProperties"],
      array: ["items", "minItems", "maxItems"],
      string: ["minLength", "maxLength"],
      number: ["minimum", "maximum"],
      integer: ["minimum", "maximum"],
      boolean: [],
      null: [],
    };
    if (typeof s.type !== "string" || !Object.hasOwn(kinds, s.type)) fail();
    const allowed = new Set([
      "type",
      "description",
      "enum",
      ...kinds[s.type as string],
    ]);
    if (Object.keys(s).some((k) => !allowed.has(k))) fail();
    if (s.description !== undefined && typeof s.description !== "string")
      fail();
    if (
      s.enum !== undefined &&
      (!Array.isArray(s.enum) ||
        !s.enum.length ||
        s.enum.some(
          (v) =>
            v !== null && !["string", "number", "boolean"].includes(typeof v),
        ))
    )
      fail();
    for (const key of [
      "minimum",
      "maximum",
      "minItems",
      "maxItems",
      "minLength",
      "maxLength",
    ])
      if (
        s[key] !== undefined &&
        (typeof s[key] !== "number" ||
          !Number.isFinite(s[key]) ||
          ((key.startsWith("min") || key.startsWith("max")) &&
            key !== "minimum" &&
            key !== "maximum" &&
            (!Number.isInteger(s[key]) || (s[key] as number) < 0)))
      )
        fail();
    if (s.type === "object") {
      if (
        !s.properties ||
        typeof s.properties !== "object" ||
        Array.isArray(s.properties) ||
        s.additionalProperties !== false
      )
        fail();
      const properties = s.properties as Record<string, unknown>;
      if (
        !Array.isArray(s.required) ||
        s.required.some(
          (k) => typeof k !== "string" || !Object.hasOwn(properties, k),
        )
      )
        fail();
      for (const child of Object.values(properties)) visit(child, depth + 1);
    }
    if (s.type === "array") visit(s.items, depth + 1);
  };
  visit(root, 0);
  // Zod's converter treats enum as a complete schema, ignoring sibling type
  // and bound constraints. Put it in an intersection at every nested node.
  const normalize = (value: unknown): z.core.JSONSchema.JSONSchema => {
    const { enum: choices, ...s } = value as Record<string, unknown>;
    if (s.type === "object")
      s.properties = Object.fromEntries(
        Object.entries(s.properties as Record<string, unknown>).map(
          ([key, child]) => [key, normalize(child)],
        ),
      );
    if (s.type === "array") s.items = normalize(s.items);
    if (choices !== undefined) s.allOf = [{ enum: choices }];
    return s as z.core.JSONSchema.JSONSchema;
  };
  try {
    return z.fromJSONSchema(normalize(root));
  } catch {
    return fail();
  }
}

export function validatedGeneration(json: string, schema: z.ZodType): string {
  if (
    typeof json !== "string" ||
    Buffer.byteLength(json) > GENERATION_LIMITS.resultBytes
  )
    throw new Error("Model output exceeds the result limit");
  let value: unknown;
  try {
    value = JSON.parse(json);
  } catch {
    throw new Error("Model output is not valid JSON");
  }
  const result = schema.safeParse(value);
  if (!result.success)
    throw new Error("Model output does not match the declared schema");
  return JSON.stringify(result.data);
}
