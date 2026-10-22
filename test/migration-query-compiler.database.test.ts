import test from "node:test";
import assert from "node:assert/strict";
import { createMigrationQueryCompiler } from "../src/migration/query-compiler.ts";
import { prepareMigrationQueryReceipt } from "../src/migration/query-preparation.ts";
const root = process.env.MIGRATION_LEGACY_ROOT;
test(
  "actual archived query parser/compiler preserves typed values and refuses malformed canonical declarations without executing authored module",
  { skip: !root },
  async () => {
    const compile = createMigrationQueryCompiler(root!);
    const script =
      '<script type="server">{`import {query} from "page";const answer=query("$answer");export default async function(){throw Error("must never execute");return answer()}`}</script>';
    const source =
      '<Helmet><Value name="amount" type="number" default={2}/><Query name="answer">{`select $amount as amount`}</Query>' +
      script +
      "</Helmet><p>Kept</p>";
    const r = await prepareMigrationQueryReceipt(
      { source, version: 2, bindings: [], compilerIdentity: "a".repeat(64) },
      compile,
    );
    assert.deepEqual(r?.plan.scalars, {
      amount: { type: "number", default: 2 },
    });
    assert.equal(r?.plan.queries[0]?.sql, "select $amount as amount");
    assert.equal(
      await compile({ source: "<p>No server program</p>", bindings: [] }),
      null,
    );
    await assert.rejects(
      compile({
        source: "<Helmet>" + script + script + "</Helmet>",
        bindings: [],
      }),
      /compilation_refused/,
    );
    await assert.rejects(
      compile({
        source: source.replace(
          "select $amount as amount",
          "select * from missing",
        ),
        bindings: [],
      }),
      /compilation_refused/,
    );
  },
);
