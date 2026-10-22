import test from "node:test";
import assert from "node:assert/strict";
import { createPageService } from "../src/server/af-pages.ts";
import type { PageWriteRepository } from "../src/server/page-write-contracts.ts";
import * as model from "../src/page/page-model.ts";
const html = "<title>Page</title><p>Hello</p>";
function fixture(overrides: Partial<PageWriteRepository> = {}) {
  const events: string[] = [];
  const writes: PageWriteRepository = {
    inspectPublication: async () => ({ actor: "owner", replayed: null }),
    inspectSave: async () => ({
      replay: null,
      base: {
        actor: "owner",
        owner: "owner",
        ownerKind: "user",
        version: 1,
        reserved: new Set(),
        nextNodeId: 0,
      },
    }),
    preflightBackends: async () => ({
      compile: async () => {
        events.push("compile");
        return {};
      },
    }),
    commitPublication: async (input) => {
      events.push("commit");
      return {
        kind: "created",
        page: {
          id: "PAGE01",
          version: 1,
          path: "/Page",
          source: input.prepareForId("PAGE01").source,
        },
      };
    },
    commitSave: async (input) => {
      events.push("commit");
      return {
        status: 200,
        value: { version: 2, source: input.prepared.source },
        changed: true,
      };
    },
    ...overrides,
  };
  const service = createPageService({
    writes,
    database: {
      transaction: async () => {
        throw Error("write orchestration must not open SQL transactions");
      },
    },
    authority: {
      account: () => {
        throw Error("repository owns authorization");
      },
      issue: () => {
        throw Error("unused");
      },
    },
    pageModel: async () => {
      events.push("model");
      return model;
    },
    backendFiles: async () => {
      throw Error("repository owns backend metadata");
    },
    randomBytes: () => {
      throw Error("repository owns IDs");
    },
    token: () => {
      throw Error("repository owns shares");
    },
  });
  return { events, service, writes };
}
test("publish and save orchestrate compilation before commit through semantic repository port", async () => {
  const f = fixture();
  assert.equal(
    (
      await f.service.publish(
        "credential",
        { source: html, requestId: "publish" },
        "https://example.test",
      )
    ).status,
    201,
  );
  assert.deepEqual(f.events, ["model", "compile", "commit"]);
  f.events.length = 0;
  assert.equal(
    (
      await f.service.save(
        "credential",
        "PAGE01",
        "1",
        { source: html },
        "https://example.test",
      )
    ).changed,
    true,
  );
  assert.deepEqual(f.events, ["model", "compile", "commit"]);
});
test("write replay skips page loading preparation compilation and commit", async () => {
  const f = fixture({
    inspectSave: async () => ({
      replay: {
        status: 200,
        value: { version: 2, source: "saved" },
        changed: false,
      },
      base: null,
    }),
  });
  assert.equal(
    (
      await f.service.save(
        "credential",
        "PAGE01",
        undefined,
        { source: html },
        "https://example.test",
      )
    ).value.source,
    "saved",
  );
  assert.deepEqual(f.events, []);
});
