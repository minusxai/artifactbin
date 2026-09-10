import { expect, it } from "vitest";
import { parseGenerationModels } from "../configuration";
const model = {
  api: "openai-completions",
  baseUrl: "https://example.com/v1",
  model: "model-id",
  apiKeyEnv: "GENERATION__TEST_KEY",
};
it("reads connection JSON directly and resolves the existing environment reference", () => {
  const reads: string[] = [];
  const config = parseGenerationModels(
    JSON.stringify({ default: model }),
    (name) => {
      reads.push(name);
      return "test-key";
    },
  );
  expect(reads).toEqual(["GENERATION__TEST_KEY"]);
  expect(config.default).toMatchObject({
    model: "model-id",
    apiKey: "test-key",
  });
  expect(config.default).not.toHaveProperty("temperature");
  expect(config.default).not.toHaveProperty("maxTokens");
  expect(parseGenerationModels(undefined, () => undefined)).toEqual({});
});
it("rejects inline keys, role defaults, flat secret names and missing credentials", () => {
  for (const entry of [
    { ...model, apiKey: "hidden-secret" },
    { ...model, temperature: 0.9 },
    { ...model, maxTokens: 4096 },
    { ...model, apiKeyEnv: "FLAT_KEY" },
  ]) {
    expect(() =>
      parseGenerationModels(
        JSON.stringify({ default: entry }),
        () => "test-key",
      ),
    ).toThrow(/model configuration/i);
  }
  expect(() =>
    parseGenerationModels(JSON.stringify({ default: model }), () => undefined),
  ).toThrow(/model configuration/i);
});
it("rejects a file path instead of silently interpreting it as configuration", () => {
  expect(() =>
    parseGenerationModels("/hidden-path/models.json", () => undefined),
  ).toThrow("GENERATION__MODELS");
});
