import {
  GENERATION_LIMITS,
  type GenerationOptions,
} from "@artifactbin/contracts";

/** Canonical sampling settings shared by SQL demand keys and provider execution. */
export function generationOptions(
  value: unknown = {},
): Required<GenerationOptions> {
  if (
    !value ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    Object.keys(value).some(
      (key) => key !== "temperature" && key !== "maxTokens",
    )
  )
    throw new Error("Invalid generation options");
  const options = value as GenerationOptions;
  const temperature =
    options.temperature === undefined ? 0.7 : options.temperature;
  const maxTokens = options.maxTokens === undefined ? 4096 : options.maxTokens;
  if (
    typeof temperature !== "number" ||
    !Number.isFinite(temperature) ||
    temperature < 0 ||
    temperature > 2 ||
    typeof maxTokens !== "number" ||
    !Number.isInteger(maxTokens) ||
    maxTokens < 1 ||
    maxTokens > GENERATION_LIMITS.maxTokens
  )
    throw new Error("Invalid generation options");
  return { temperature, maxTokens };
}

/** Split connection selection and output schema from bounded sampling options. */
export function generationCallConfig(value: unknown) {
  if (
    !value ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    Object.keys(value).some(
      (key) => !["model", "schema", "temperature", "maxTokens"].includes(key),
    )
  )
    throw new Error("Invalid generation config");
  const { model, schema, ...options } = value as Record<string, unknown>;
  if (
    typeof model !== "string" ||
    !/^[a-zA-Z][\w-]{0,63}$/.test(model) ||
    !schema ||
    typeof schema !== "object" ||
    Array.isArray(schema)
  )
    throw new Error("Generation config requires a model and output schema");
  return {
    model,
    schema: JSON.stringify(schema),
    options: generationOptions(options),
  };
}
