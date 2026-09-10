/** Per-call sampling settings; never provider destinations or credentials. */
export interface GenerationOptions {
  temperature?: number;
  maxTokens?: number;
}

/** Model effects are requested by SQL and fulfilled by the app, never by DuckDB. */
export interface GenerationRequest {
  key: string;
  model: string;
  prompt: string;
  schema: string;
  options?: GenerationOptions;
}

/** Keys are scoped to a single invocation, not a global prompt cache. */
export type GenerationResults = Record<string, string>;

export interface GenerationUsage {
  input: number;
  output: number;
}

export interface GenerationResult {
  json: string;
  usage: GenerationUsage;
}

export interface GenerationService {
  generate(
    request: GenerationRequest,
    signal: AbortSignal,
  ): Promise<GenerationResult>;
}

export const GENERATION_LIMITS = {
  calls: 4,
  optionsBytes: 1024,
  maxTokens: 16_384,
  promptBytes: 64_000,
  schemaBytes: 8_000,
  resultBytes: 64_000,
  timeoutMs: 180_000,
} as const;

/** Allows SQL/persistence overhead after the bounded model work. */
export const MUTATION_REPLY_TIMEOUT_MS = GENERATION_LIMITS.timeoutMs + 20_000;
