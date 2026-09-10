import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, afterEach, expect, it } from "vitest";
import { loadGenerationModels, parseGenerationModels } from "../configuration";
const dir = mkdtempSync(join(tmpdir(), "generation-config-"));
afterAll(() => rmSync(dir, {recursive:true,force:true}));
afterEach(() => rmSync(join(dir, "models.json"), { force: true }));
const model = {
  api: "openai-completions",
  baseUrl: "https://example.com/v1",
  model: "model-id",
  apiKeyEnv: "GENERATION__TEST_KEY",
};
it("loads a model file and resolves credentials without role-specific defaults", () => {
  const path = join(dir, "models.json");
  writeFileSync(path, JSON.stringify({ default: model }));
  const reads: string[] = [];
  const config = loadGenerationModels(path, (key) => {
    reads.push(key);
    return "test-key";
  });
  expect(reads).toEqual(["GENERATION__TEST_KEY"]);
  expect(config.default).toMatchObject({
    model: "model-id",
    apiKey: "test-key",
  });
  expect(config.default).not.toHaveProperty("temperature");
  expect(config.default).not.toHaveProperty("maxTokens");
  expect(loadGenerationModels(undefined, () => undefined)).toEqual({});
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
  expect(()=>parseGenerationModels(JSON.stringify({default:model}),()=>undefined)).toThrow(/model configuration/i);
});
it("sanitizes malformed files and missing paths", () => {
  const path = join(dir, "models.json");
  writeFileSync(path, "hidden-secret");
  for (const file of [path, join(dir, "missing-secret")]) {
    try {
      loadGenerationModels(file, () => undefined);
      throw Error("unexpected success");
    } catch (e) {
      expect(String(e)).toContain("model configuration");
      expect(String(e)).not.toContain("hidden-secret");
      expect(String(e)).not.toContain("missing-secret");
    }
  }
});
