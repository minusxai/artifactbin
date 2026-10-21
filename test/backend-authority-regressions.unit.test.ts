import test from "node:test";
import assert from "node:assert/strict";
import {
  BACKEND_RUNTIME,
  sealDeployment,
  verifyDeployment,
} from "../src/backend/deployment.ts";

test("deployment owns immutable metadata and records the actual image outside its version", () => {
  const metadata = {
    typeDefs: "type Query { value: Int! }",
    fields: ["value"],
    runtime: BACKEND_RUNTIME + "/image:sha256:" + "a".repeat(64),
  };
  const a = sealDeployment("source", "bundle", metadata);
  metadata.fields.push("injected");
  metadata.typeDefs = "broken";
  verifyDeployment(a);
  const b = sealDeployment("source", "bundle", {
    typeDefs: a.typeDefs,
    fields: [...a.fields],
    runtime: BACKEND_RUNTIME + "/image:sha256:" + "b".repeat(64),
  });
  // The image is recorded, but a rebuild must not change the backend's version.
  assert.notEqual(a.runtime, b.runtime);
  assert.equal(a.version, b.version);
  assert.ok(Object.isFrozen(a.fields));
  let hits = 0;
  const corrupt = { ...a };
  Object.defineProperty(corrupt, "bundle", {
    get() {
      hits++;
      return "bundle";
    },
    enumerable: true,
  });
  assert.throws(() => verifyDeployment(corrupt), /deployment_invalid/);
  assert.equal(hits, 0);
});

test("compiler accepts owned frozen metadata with multiple root fields without mutating it", async () => {
  const { compileBackend } = await import("../src/backend/compiler.ts");
  const { jsonCopy } = await import("../src/json.ts");
  const metadata = jsonCopy({
    typeDefs: "type Query { a: Int, b: Int }",
    fields: ["b", "a"],
    roots: { Query: ["b", "a"], Mutation: [] },
  });
  const artifact = await compileBackend("source", async () => ({
    bundle: "bundle",
    metadata,
    runtime: BACKEND_RUNTIME,
  }));
  assert.deepEqual(artifact.fields, ["a", "b"]);
  assert.deepEqual(metadata.roots.Query, ["b", "a"]);
});
