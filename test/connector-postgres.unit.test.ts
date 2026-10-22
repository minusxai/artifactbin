import test from "node:test";
import assert from "node:assert/strict";
import { createConnectorHost } from "../src/connectors/index.ts";
import type { PgClient } from "../src/connectors/contracts.ts";

for (const phase of ["acquisition", "execution"] as const)
  test(`PostgreSQL total deadline during ${phase} preserves the dispatch boundary`, async (t) => {
    t.mock.timers.enable({ apis: ["setTimeout"] });
    let acquired!: (client: PgClient) => void, started!: () => void;
    let dispatched = 0,
      releases = 0;
    const queryStarted = new Promise<void>((resolve) => {
      started = resolve;
    });
    const client: PgClient = {
      query(text) {
        if (text === "SELECT slow") {
          dispatched++;
          started();
          return new Promise(() => {});
        }
        return Promise.resolve({ rows: [] });
      },
      release(destroy) {
        assert.equal(destroy, true);
        releases++;
      },
    };
    const host = createConnectorHost(
      {
        db: {
          kind: "postgres",
          pool: {
            connect: () =>
              phase === "acquisition"
                ? new Promise((resolve) => {
                    acquired = resolve;
                  })
                : Promise.resolve(client),
            end: async () => {},
          },
          operations: { slow: { text: "SELECT slow", params: () => [] } },
        },
      },
      { timeoutMs: 80 },
    );
    const pending = host.invoke(
      {
        tenant: "fixture",
        subject: "reader",
        grants: [{ resource: "db", operation: "slow" }],
      },
      { resource: "db", operation: "slow", input: null },
    );
    const rejected = assert.rejects(pending, {
      code: "TIMEOUT",
      outcome: phase === "acquisition" ? "not-executed" : "unknown",
    });
    try {
      if (phase === "execution") await queryStarted;
      else await Promise.resolve();
      t.mock.timers.tick(80);
      await rejected;
      if (phase === "acquisition") {
        assert.equal(dispatched, 0);
        acquired(client);
        await new Promise<void>((resolve) => setImmediate(resolve));
      } else assert.equal(dispatched, 1);
      assert.equal(releases, 1);
    } finally {
      await host.close();
    }
  });
