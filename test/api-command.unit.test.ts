import test from "node:test";
import assert from "node:assert/strict";
import { parseApiCommand } from "../src/server/api-command.ts";
const decode = (method: string, path: string, body = {}, headers = {}) =>
  parseApiCommand({
    method,
    url: new URL(path, "https://example.test"),
    body,
    headers,
  });
test("file commands bind exact verbs and named identities without validating payloads", () => {
  const cases = [
    ["GET", "source", "source.read"],
    ["PUT", "source", "source.save"],
    ["GET", "comments", "comments.list"],
    ["POST", "comments", "comments.add"],
    ["PUT", "comments/item", "comments.edit"],
    ["POST", "capture", "comments.capture"],
    ["GET", "context/item", "comments.context"],
    ["GET", "permissions", "collaboration"],
    ["GET", "sharing", "collaboration"],
    ["PUT", "sharing", "collaboration"],
    ["GET", "profiles", "collaboration"],
    ["GET", "presence", "collaboration"],
    ["PUT", "presence", "collaboration"],
    ["POST", "revoke", "collaboration"],
  ];
  for (const [method, tail, kind] of cases) {
    const c = decode(method!, "/api/files/Pg4mQ2/" + tail, {
      sessionId: 42,
      visibility: [],
    });
    assert.equal(c?.kind, kind);
    assert.equal(c?.fileId, "Pg4mQ2");
    for (const verb of ["GET", "POST", "PUT", "DELETE", "HEAD"]) {
      if (!cases.some(([m, t]) => m === verb && t === tail))
        assert.equal(decode(verb, "/api/files/Pg4mQ2/" + tail), null);
    }
  }
  assert.deepEqual(decode("GET", "/api/files/Pg4mQ2/context/item"), {
    kind: "comments.context",
    fileId: "Pg4mQ2",
    commentId: "item",
  });
  for (const path of [
    "/api/files/longidentity/source",
    "/api/files/Pg4mQ2/source/extra",
    "/api/files/Pg4mQ2/comments//item",
    "/api/files/Pg4mQ2/comments/",
    "/api//files/Pg4mQ2/source",
    "/api/files/Pg4mQ2/sync",
  ])
    assert.equal(decode("GET", path), null);
});
test("headers retain endpoint-specific semantics and untrusted data is not coerced", () => {
  const body = { comment: null, sessionId: 42 };
  assert.deepEqual(
    decode("PUT", "/api/files/Pg4mQ2/source", body, {
      ifMatch: ['"7"', '"8"'],
      idempotencyKey: ["a", "b"],
    }),
    {
      kind: "source.save",
      fileId: "Pg4mQ2",
      body,
      ifMatch: '"7"',
      key: ["a", "b"],
    },
  );
  const c = decode(
    "PUT",
    "/api/files/Pg4mQ2/sharing",
    { visibility: [] },
    { ifMatch: '"bad"' },
  );
  assert.ok(c?.kind === "collaboration" && c.command.kind === "change-sharing");
  assert.equal(Number.isNaN(c.command.expectedVersion), true);
  assert.deepEqual(c.command.policy, { visibility: [] });
  assert.deepEqual(decode("POST", "/api/files/Pg4mQ2/capture", body), {
    kind: "comments.capture",
    fileId: "Pg4mQ2",
    sessionId: 42,
  });
  for (const method of ["GET", "POST", "PUT", "DELETE"]) {
    assert.equal(decode(method, "/api/files/Pg4mQ2/graphql")?.kind, "backend");
  }
});

test("thread read grammar decodes opaque IDs once and never aliases write endpoints",()=>{
 assert.deepEqual(decode("GET","/api/files/Pg4mQ2/comments/reply%2Fopaque/thread"),{kind:"comments.thread",fileId:"Pg4mQ2",commentId:"reply/opaque"});
 assert.equal(decode("PUT","/api/files/Pg4mQ2/comments/root/thread"),null);
 assert.equal(decode("GET","/api/files/Pg4mQ2/comments/root/thread/extra"),null);
 assert.throws(()=>decode("GET","/api/files/Pg4mQ2/comments/%zz/thread"));
});
