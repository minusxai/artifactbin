import { generationCallConfig } from "@artifactbin/utils";
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
    returnType: native.VARCHAR,
    volatile: true,
    specialHandling: true,
    mainFunction(info, chunk, output) {
      if (!(output instanceof native.DuckDBVarCharVector)) {
        info.setError("Invalid generation result type");
        return;
      }
      for (let i = 0; i < chunk.rowCount; i++) {
        // Publish validates SQL types using a NULL VARCHAR stub. It never
        // requests generation, even for a constant INSERT against no rows.
        if (dryRun) {
          output.setItem(i, null);
          continue;
        }
        const [text, system, rawConfig] = chunk.getRowValues(i);
        if (
          typeof text !== "string" ||
          !text.trim() ||
          typeof system !== "string" ||
          Buffer.byteLength(text) + Buffer.byteLength(system) >
            GENERATION_LIMITS.promptBytes ||
          typeof rawConfig !== "string" ||
          Buffer.byteLength(rawConfig) > GENERATION_LIMITS.configBytes
        ) {
          info.setError(
            "llm expects text, system (64 KB combined maximum), and a JSON config (10 KB maximum)",
          );
          return;
        }
        let config;
        try {
          config = generationCallConfig(JSON.parse(rawConfig));
          if (Buffer.byteLength(config.schema) > GENERATION_LIMITS.schemaBytes)
            throw Error("Schema too large");
        } catch {
          info.setError(
            "llm config requires model and schema (8 KB maximum), with optional temperature (0–2) and maxTokens (1–16384)",
          );
          return;
        }
        const { model, schema, options } = config;
        const key = createHash("sha256")
          .update(JSON.stringify([model, text, system, schema, options]))
          .digest("hex");
        if (!Object.hasOwn(results, key)) {
          pending ??= { key, model, text, system, schema, options };
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
