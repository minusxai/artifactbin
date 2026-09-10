import { generationOptions } from "@artifactbin/utils";
import { createHash } from "node:crypto";
import type { DuckDBConnection } from "@duckdb/node-api";
import {
  GENERATION_LIMITS,
  type GenerationRequest,
  type GenerationResults,
} from "@artifactbin/contracts";

/** A synchronous, network-free demand boundary. DuckDB aborts the throwaway
 * statement on a cache miss; the app supplies the result on its next execution.
 * The native module is passed by the engine to preserve its lazy-load boundary. */
export function registerGeneration(
  conn: DuckDBConnection,
  native: typeof import("@duckdb/node-api"),
  results: GenerationResults = {},
  dryRun = false,
): () => GenerationRequest | undefined {
  let pending: GenerationRequest | undefined;
  const fn = native.DuckDBScalarFunction.create({
    name: "llm",
    parameterTypes: [native.VARCHAR, native.VARCHAR, native.VARCHAR],
    varArgsType: native.VARCHAR,
    returnType: native.VARCHAR,
    volatile: true,
    specialHandling: true,
    mainFunction(info, chunk, output) {
      if (!(output instanceof native.DuckDBVarCharVector)) {
        info.setError("Invalid generation result type");
        return;
      }
      for (let i = 0; i < chunk.rowCount; i++) {
        const args = chunk.getRowValues(i);
        if (args.length < 3 || args.length > 4) {
          info.setError(
            "llm expects three arguments and optional JSON options",
          );
          return;
        }
        // Publish validates SQL types using a NULL VARCHAR stub. It never
        // requests generation, even for a constant INSERT against no rows.
        if (dryRun) {
          output.setItem(i, null);
          continue;
        }
        const [model, prompt, schema, rawOptions] = args;
        if (
          typeof model !== "string" ||
          !/^[a-zA-Z][\w-]{0,63}$/.test(model) ||
          typeof prompt !== "string" ||
          !prompt.trim() ||
          Buffer.byteLength(prompt) > GENERATION_LIMITS.promptBytes ||
          typeof schema !== "string" ||
          Buffer.byteLength(schema) > GENERATION_LIMITS.schemaBytes
        ) {
          info.setError(
            "llm expects a configured model alias, a nonempty prompt (64 KB maximum), and a JSON schema (8 KB maximum)",
          );
          return;
        }
        let options;
        try {
          if (
            args.length === 4 &&
            (typeof rawOptions !== "string" ||
              Buffer.byteLength(rawOptions) > GENERATION_LIMITS.optionsBytes)
          )
            throw new Error("Invalid options");
          options = generationOptions(
            args.length === 4 ? JSON.parse(rawOptions as string) : {},
          );
        } catch {
          info.setError(
            "llm options must contain only temperature (0–2) and maxTokens (1–16384)",
          );
          return;
        }
        const key = createHash("sha256")
          .update(JSON.stringify([model, prompt, schema, options]))
          .digest("hex");
        if (!Object.hasOwn(results, key)) {
          pending ??= { key, model, prompt, schema, options };
          info.setError("Model result required");
          return;
        }
        const value = results[key];
        if (
          typeof value !== "string" ||
          Buffer.byteLength(value) > GENERATION_LIMITS.resultBytes
        ) {
          info.setError("Invalid supplied model result");
          return;
        }
        output.setItem(i, value);
      }
      output.flush();
    },
  });
  conn.registerScalarFunction(fn);
  return () => pending;
}
