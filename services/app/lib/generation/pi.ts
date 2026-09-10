import type { Context, Model } from "@earendil-works/pi-ai";
import { stream as completions } from "@earendil-works/pi-ai/api/openai-completions";
import { stream as responses } from "@earendil-works/pi-ai/api/openai-responses";
import { stream as anthropic } from "@earendil-works/pi-ai/api/anthropic-messages";
import { stream as google } from "@earendil-works/pi-ai/api/google-generative-ai";
import { generationOptions } from "@artifactbin/utils";
import { GENERATION_LIMITS } from "@artifactbin/contracts";
import type { GenerationService } from "@artifactbin/contracts";
import type { GenerationModels } from "./configuration";

/** Pi is transport only: explicit credentials, no catalog/auth discovery,
 * ambient login, tools or agent loop. Only operator-configured endpoints run. */
export function createPiGeneration(
  models: GenerationModels,
): GenerationService {
  let active = 0;
  return {
    async generate(request, signal) {
      if (!Object.hasOwn(models, request.model))
        throw new Error("Model alias is not configured");
      if (active >= 4) throw new Error("Generation capacity reached");
      signal.throwIfAborted();
      const config = models[request.model];
      const sampling = generationOptions(request.options);
      const model = {
        id: config.model,
        name: request.model,
        api: config.api,
        baseUrl: config.baseUrl,
        provider: "artifactbin",
        reasoning: false,
        input: ["text" as const],
        contextWindow: 131072,
        maxTokens: GENERATION_LIMITS.maxTokens,
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
      } satisfies Model<typeof config.api>;
      const context: Context = {
        systemPrompt: `Return JSON only, without markdown or commentary. Your output must satisfy this JSON schema:\n${request.schema}`,
        messages: [
          { role: "user", content: request.prompt, timestamp: Date.now() },
        ],
      };
      const options = {
        apiKey: config.apiKey,
        signal,
        ...sampling,
        maxRetries: 0,
      };
      active++;
      try {
        const stream =
          config.api === "openai-completions"
            ? completions({ ...model, api: config.api }, context, options)
            : config.api === "openai-responses"
              ? responses({ ...model, api: config.api }, context, options)
              : config.api === "anthropic-messages"
                ? anthropic({ ...model, api: config.api }, context, options)
                : google({ ...model, api: config.api }, context, options);
        const answer = await stream.result();
        if (answer.stopReason !== "stop")
          throw new Error("Model did not finish a JSON response");
        return {
          json: answer.content
            .filter((c) => c.type === "text")
            .map((c) => c.text)
            .join(""),
          usage: { input: answer.usage.input, output: answer.usage.output },
        };
      } catch {
        throw new Error(
          signal.aborted ? "Model request canceled" : "Model request failed",
        );
      } finally {
        active--;
      }
    },
  };
}
