import { generationOptions } from "@artifactbin/utils";
import {
  GENERATION_LIMITS,
  isQueryFailure,
  type GenerationResults,
  type GenerationRequest,
  type GenerationService,
  type MutationInput,
  type MutationOutcome,
  type SqlService,
} from "@artifactbin/contracts";
import { generationSchema, validatedGeneration } from "./schema";

export function createGenerationInvocation(
  service: GenerationService,
  options: { timeoutMs?: number; beforeCall?: (request: GenerationRequest) => Promise<void> } = {},
): {
  run(
    input: MutationInput,
    engine: Pick<SqlService, "mutate">,
  ): Promise<MutationOutcome>;
} {
  const results: GenerationResults = {};
  let calls = 0;
  const timeoutMs = Math.min(
    options.timeoutMs ?? GENERATION_LIMITS.timeoutMs,
    GENERATION_LIMITS.timeoutMs,
  );
  let generationDeadline: number | undefined;
  return {
    async run(input, engine) {
      for (;;) {
        const out = await engine.mutate({
          ...input,
          generationResults: results,
        });
        if (!isQueryFailure(out) || !out.generation) return out;
        const request = out.generation;
        if (Object.hasOwn(results, request.key))
          throw new Error("SQL did not consume the supplied model result");
        if (calls >= GENERATION_LIMITS.calls)
          throw new Error("Generation call limit exceeded (4 per mutation)");
        const schema = generationSchema(request.schema);
        const sampling = generationOptions(request.options);
        await options.beforeCall?.(request);
        calls++;
        generationDeadline ??= Date.now() + timeoutMs;
        const remaining = generationDeadline - Date.now();
        if (remaining <= 0) throw new Error("Model generation timed out");
        const controller = new AbortController();
        let timer: ReturnType<typeof setTimeout> | undefined;
        const deadline = new Promise<never>((_resolve, reject) => {
          timer = setTimeout(() => {
            controller.abort();
            reject(new Error("Model generation timed out"));
          }, remaining);
        });
        try {
          const answer = await Promise.race([
            service
              .generate({ ...request, options: sampling }, controller.signal)
              .catch(() => {
                throw new Error(
                  "Model generation failed; check model configuration or try again",
                );
              }),
            deadline,
          ]);
          results[request.key] = validatedGeneration(answer.json, schema);
        } finally {
          clearTimeout(timer);
        }
      }
    },
  };
}
