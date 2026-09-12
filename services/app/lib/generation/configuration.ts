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
    "Invalid model configuration: use GENERATION__MODELS with {api, baseUrl, model, apiKeyEnv}; referenced secrets must be set.",
  );

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

/** Operator permission is separate from the dataset owner's policy. Each pool
 * caps dispatches per UTC day and tokens per call; it is not a dollar estimate. */
interface PublicGenerationPool {models:string[];callsPerDay:number;maxTokens:number}
export function parsePublicGenerationPools(source:string|undefined):Record<string,PublicGenerationPool>{
 if(!source?.trim())return {};
 const value:unknown=JSON.parse(source);
 if(!value||typeof value!=='object'||Array.isArray(value))throw new Error('Invalid GENERATION__PUBLIC_POOLS');
 for(const [id,pool] of Object.entries(value)){
  const p=pool as PublicGenerationPool;
  if(!/^[a-zA-Z0-9]+$/.test(id)||!p||Object.keys(p).some(k=>!['models','callsPerDay','maxTokens'].includes(k))||!Array.isArray(p.models)||p.models.some(m=>typeof m!=='string')||!Number.isSafeInteger(p.callsPerDay)||p.callsPerDay<1||!Number.isSafeInteger(p.maxTokens)||p.maxTokens<1||p.maxTokens>16384)throw new Error('Invalid GENERATION__PUBLIC_POOLS');
 }return value as Record<string,PublicGenerationPool>;
}
