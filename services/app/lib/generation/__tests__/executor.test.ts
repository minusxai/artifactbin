import { describe, expect, it, vi } from "vitest";
import { createSql } from "@artifactbin/sql/local";
import { createGenerationInvocation } from "../executor";

const schema = JSON.stringify({
  type: "object",
  properties: { score: { type: "number", minimum: 0, maximum: 10 } },
  required: ["score"],
  additionalProperties: false,
});
const input = {
  table: {
    name: "nodes",
    rows: [],
    columns: [{ name: "result", type: "string" as const }],
  },
  sql: "insert into nodes select llm('narrator', $prompt, $schema)",
  params: { prompt: "hello", schema },
};
const engine = createSql();
const result = (json = '{"score":6}') => ({
  json,
  usage: { input: 20, output: 5 },
});

describe("generation invocation", () => {
  it("reuses validated results when persistence retries SQL against newer rows", async () => {
    const generate = vi.fn(async () => result());
    const invocation = createGenerationInvocation({ generate });
    expect(await invocation.run(input, engine)).toMatchObject({
      rows: [{ result: '{"score":6}' }],
    });
    expect(
      await invocation.run(
        { ...input, table: { ...input.table, rows: [{ result: "existing" }] } },
        engine,
      ),
    ).toMatchObject({
      rows: [{ result: "existing" }, { result: '{"score":6}' }],
    });
    expect(generate).toHaveBeenCalledTimes(1);
  });
  it("does not cache across separate user invocations", async () => {
    const generate = vi.fn(async () => result());
    await createGenerationInvocation({ generate }).run(input, engine);
    await createGenerationInvocation({ generate }).run(input, engine);
    expect(generate).toHaveBeenCalledTimes(2);
  });
  it.each([
    "not JSON",
    '{"score":99}',
    '{"score":"6"}',
    '{"score":6,"extra":"unexpected"}',
  ])("refuses invalid results before returning rows: %s", async (json) => {
    const invocation = createGenerationInvocation({
      generate: async () => result(json),
    });
    await expect(invocation.run(input, engine)).rejects.toThrow("Model output");
  });
  it("refuses unsupported schemas before contacting a provider", async () => {
    const generate = vi.fn(async () => result());
    await expect(
      createGenerationInvocation({ generate }).run(
        {
          ...input,
          params: {
            ...input.params,
            schema: '{"$ref":"https://example.com/schema"}',
          },
        },
        engine,
      ),
    ).rejects.toThrow("schema");
    expect(generate).not.toHaveBeenCalled();
  });
  it("bounds waiting even when a provider ignores cancellation", async () => {
    const generate = vi.fn((_r, _signal) => new Promise<never>(() => {}));
    await expect(
      createGenerationInvocation({ generate }, { timeoutMs: 50 }).run(
        input,
        engine,
      ),
    ).rejects.toThrow("timed out");
    expect(generate.mock.calls[0][1].aborted).toBe(true);
  });
  it("caps distinct calls across SQL replays", async () => {
    const generate = vi.fn(async () => result());
    const many = {
      ...input,
      sql: "insert into nodes select llm('narrator', 'prompt ' || n, $schema) from range(8) r(n)",
    };
    await expect(
      createGenerationInvocation({ generate }).run(many, engine),
    ).rejects.toThrow("call limit");
    expect(generate).toHaveBeenCalledTimes(4);
  });
});
