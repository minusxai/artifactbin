import test from "node:test";
import assert from "node:assert/strict";
import { parseFileRoute, parseRequestBody } from "../src/server/request.ts";

const endpoints = [
  "source",
  "comments",
  "comments/item",
  "context/item",
  "capture",
  "permissions",
  "sharing",
  "profiles",
  "presence",
  "revoke",
  "sync",
  "sync/checkpoint",
  "sync/intents/ack",
  "backends",
  "graphql",
];

test("request bodies accept only JSON objects and hide parser diagnostics", () => {
  assert.deepEqual(parseRequestBody(""), {});
  assert.deepEqual(
    parseRequestBody('{"nested":{"list":[1,null]},"flag":true}'),
    {
      nested: { list: [1, null] },
      flag: true,
    },
  );
  for (const raw of ['{"broken":', "{", "undefined", " "]) {
    assert.throws(() => parseRequestBody(raw), {
      status: 400,
      message: "Invalid JSON request body",
    });
  }
  for (const raw of [
    "null",
    "true",
    "false",
    "42",
    '"command"',
    "[]",
    "[{}]",
  ]) {
    assert.throws(() => parseRequestBody(raw), {
      status: 400,
      message: "JSON request body must be an object",
    });
  }
});

test("file routes preserve exact endpoint and six-character file IDs", () => {
  for (const fileId of ["Pg4mQ2", "abcdef", "000000"]) {
    for (const endpoint of endpoints) {
      const path = `/api/files/${fileId}/${endpoint}`;
      assert.deepEqual(parseFileRoute(path), {
        fileId,
        parts: ["api", "files", fileId, ...endpoint.split("/")],
      });
    }
  }
});

test("file route grammar rejects suffixes, missing identities and repeated separators", () => {
  for (const endpoint of endpoints) {
    for (const suffix of endpoint === "comments"
      ? ["/", "/extra/again"]
      : ["/", "/extra", "/extra/again"]) {
      assert.equal(
        parseFileRoute(`/api/files/Pg4mQ2/${endpoint}${suffix}`),
        null,
      );
    }
    for (const prefix of [
      "/api//files/missing/",
      "/api/files//",
      "api/files/missing/",
      "/other/files/missing/",
    ]) {
      assert.equal(parseFileRoute(prefix + endpoint), null);
    }
  }
  for (const fileId of ["missing", "a-b_12", "Pg4mQ", "Pg4mQ2x", "abcdefghijkl", "encoded%20id"])
    assert.equal(parseFileRoute(`/api/files/${fileId}/source`), null, fileId);
  for (const path of [
    "/api/files/missing",
    "/api/files/missing/",
    "/api/files/missing/context",
    "/api/files/missing/comments//item",
    "/api/files/missing/sync/intents",
    "/api/files/Pg4mQ2/backend/deploy",
    "/api/files/Pg4mQ2/sources",
  ]) {
    assert.equal(parseFileRoute(path), null);
  }
});
