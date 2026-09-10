import { afterAll, describe, expect, it } from "vitest";
import { isQueryFailure, type SqlService } from "@artifactbin/contracts";
import { serveSql, sqlClient } from "@artifactbin/sql";
import { createSql } from "@artifactbin/sql/local";

const local = createSql();
const server = serveSql(local);
const remote = sqlClient(server.listen(0).url);
afterAll(() => server.close());
const table = {
  name: "nodes",
  rows: [],
  columns: [{ name: "result", type: "string" as const }],
};
const schema = JSON.stringify({
  type: "object",
  properties: { score: { type: "number" } },
  required: ["score"],
  additionalProperties: false,
});
const config = JSON.stringify({ model: "default", schema: JSON.parse(schema) });
const sql = `insert into nodes select llm($text, $system, $config)`;
const params = {
  text: "What happens?",
  system: "Narrate the next moment.",
  config,
};

describe.each<[string, SqlService]>([
  ["local", local],
  ["HTTP", remote],
])("generation %s", (_name, svc) => {
  it("suspends with no changed rows, then resumes with a supplied result", async () => {
    const suspended = await svc.mutate({ table, sql, params });
    expect(suspended).toMatchObject({
      generation: {
        model: "default",
        text: params.text,
        system: params.system,
        schema,
      },
    });
    expect(suspended).not.toHaveProperty("rows");
    if (!isQueryFailure(suspended) || !suspended.generation)
      throw Error("missing generation");
    const resumed = await svc.mutate({
      table,
      sql,
      params,
      generationResults: { [suspended.generation.key]: '{"score":6}' },
    });
    expect(resumed).toMatchObject({
      affected: 1,
      rows: [{ result: '{"score":6}' }],
    });
  });

  it("materializes narration and requests the judge only for a decisive score", async () => {
    const statement = `insert into nodes with narration as materialized (select llm($text, $system, $config) as result)
      select case when (result::json->>'score')::double > 8 then llm(result, 'Judge the ending.', $config) else result end from narration`;
    const first = await svc.mutate({ table, sql: statement, params });
    if (!isQueryFailure(first) || !first.generation)
      throw Error("missing narrator");
    const results = { [first.generation.key]: '{"score":6}' };
    expect(
      await svc.mutate({
        table,
        sql: statement,
        params,
        generationResults: results,
      }),
    ).toMatchObject({ rows: [{ result: '{"score":6}' }] });
    results[first.generation.key] = '{"score":9}';
    const second = await svc.mutate({
      table,
      sql: statement,
      params,
      generationResults: results,
    });
    expect(second).toMatchObject({
      generation: {
        model: "default",
        text: '{"score":9}',
        system: "Judge the ending.",
      },
    });
    if (!isQueryFailure(second) || !second.generation)
      throw Error("missing judge");
    results[second.generation.key] = '{"score":8}';
    expect(
      await svc.mutate({
        table,
        sql: statement,
        params,
        generationResults: results,
      }),
    ).toMatchObject({ rows: [{ result: '{"score":8}' }] });
  });

  it("validates mutation SQL without requesting generation", async () => {
    expect(
      await svc.dryRunMutations({
        tables: { nodes: table },
        mutations: [{ name: "step", target: "nodes", tableName: "nodes", sql }],
        paramNames: ["text", "system", "config"],
      }),
    ).toEqual({ errors: [] });
    const literal = `insert into nodes values (llm('hello', 'Narrate.', '${config}'))`;
    expect(
      await svc.dryRunMutations({
        tables: { nodes: table },
        mutations: [
          { name: "step", target: "nodes", tableName: "nodes", sql: literal },
        ],
        paramNames: [],
      }),
    ).toEqual({ errors: [] });
  });

  it("never exposes the function to reactive reads", async () => {
    const read = await svc.run({
      tables: {},
      queries: [{ name: "q", sql: "select llm($text, $system, $config)" }],
      params,
    });
    expect(read.q).toHaveProperty("error");
    expect(read.q).not.toHaveProperty("generation");
  });

  it("normalizes per-call options and keys distinct sampling settings separately", async () => {
    const demand = async (options = "{}", system = params.system) => {
      const out = await svc.mutate({
        table,
        sql,
        params: {
          ...params,
          system,
          config: JSON.stringify({
            ...JSON.parse(config),
            ...JSON.parse(options),
          }),
        },
      });
      if (!isQueryFailure(out) || !out.generation)
        throw Error("missing generation");
      return out.generation;
    };
    const first = await demand('{"temperature":0.9,"maxTokens":8192}');
    expect(first.options).toEqual({ temperature: 0.9, maxTokens: 8192 });
    expect((await demand('{"maxTokens":8192,"temperature":0.9}')).key).toBe(
      first.key,
    );
    expect((await demand('{"temperature":0.3,"maxTokens":8192}')).key).not.toBe(
      first.key,
    );
    expect((await demand('{"temperature":0.7,"maxTokens":4096}')).key).toBe(
      (await demand()).key,
    );
    expect((await demand("{}", "A different system instruction")).key).not.toBe(
      (await demand()).key,
    );
  });

  it.each([
    "null",
    "[]",
    '{"temperature":3}',
    '{"maxTokens":0}',
    '{"maxTokens":16385}',
    '{"maxTokens":1.5}',
    '{"apiKey":"no"}',
    '{"baseUrl":"http://example.com"}',
    "oops",
  ])(
    "rejects invalid call options %s before requesting a model",
    async (options) => {
      const out = await svc.mutate({
        table,
        sql,
        params: {
          ...params,
          config: options.startsWith("{")
            ? JSON.stringify({ ...JSON.parse(config), ...JSON.parse(options) })
            : options,
        },
      });
      expect(out).toHaveProperty("error");
      expect(out).not.toHaveProperty("generation");
    },
  );

  it("requires the new call config and bounds system instructions", async () => {
    for (const values of [
      { config: "{}" },
      { config: JSON.stringify({ model: "default", schema: null }) },
      { system: "x".repeat(64001) },
      { config: "x".repeat(10001) },
    ]) {
      const out = await svc.mutate({
        table,
        sql,
        params: { ...params, ...values },
      });
      expect(out).toHaveProperty("error");
      expect(out).not.toHaveProperty("generation");
    }
  });

  it("bounds effect arguments before returning them to the app", async () => {
    const out = await svc.mutate({
      table,
      sql,
      params: { ...params, text: "x".repeat(64_001) },
    });
    expect(out).toHaveProperty("error");
    expect(out).not.toHaveProperty("generation");
  });
});
