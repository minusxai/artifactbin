import { readFileSync } from "node:fs";
import { z } from "zod";

const configuredModel = z
  .object({
    api: z.enum([
      "openai-completions",
      "openai-responses",
      "anthropic-messages",
      "google-generative-ai",
    ]),
    baseUrl: z
      .string()
      .url()
      .refine((value) => {
        const url = new URL(value);
        return (
          ["http:", "https:"].includes(url.protocol) &&
          !url.username &&
          !url.password &&
          !url.search &&
          !url.hash
        );
      }),
    model: z.string().min(1).max(200),
    apiKeyEnv: z.string().regex(/^[A-Z][A-Z0-9_]*__[A-Z][A-Z0-9_]*$/),
  })
  .strict();
const models = z.record(
  z.string().regex(/^[a-zA-Z][\w-]{0,63}$/),
  configuredModel,
);
export type GenerationModels = Record<
  string,
  Omit<z.infer<typeof configuredModel>, "apiKeyEnv"> & { apiKey: string }
>;
type ReadSecret = (name: string) => string | undefined;
const configError = () =>
  new Error(
    "Invalid model configuration: use GENERATION__MODELS_FILE with {api, baseUrl, model, apiKeyEnv}; referenced secrets must be set.",
  );

export function loadGenerationModels(
  path: string | undefined,
  readSecret: ReadSecret,
): GenerationModels {
  if (!path?.trim()) return {};
  try {
    return parseGenerationModels(readFileSync(path, "utf8"), readSecret);
  } catch {
    throw configError();
  }
}

export function parseGenerationModels(
  source: string | undefined,
  readSecret: ReadSecret,
): GenerationModels {
  if (!source?.trim()) return {};
  try {
    const parsed = models.parse(JSON.parse(source));
    return Object.fromEntries(
      Object.entries(parsed).map(([alias, { apiKeyEnv, ...connection }]) => {
        const apiKey = readSecret(apiKeyEnv);
        if (!apiKey?.trim()) throw configError();
        return [alias, { ...connection, apiKey }];
      }),
    );
  } catch {
    throw configError();
  }
}
