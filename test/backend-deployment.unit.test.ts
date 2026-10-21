import test from "node:test";
import assert from "node:assert/strict";
import { createBackendHost } from "../src/backend/container-host.ts";
import { sealDeployment, verifyDeployment } from "../src/backend/deployment.ts";
const source = `export const typeDefs='type Query { value: Int! }';export default {Query:{value(){return 7}}}`;
test("deployment pins executable, schema, source and runtime; rejects tampering", () => {
  const artifact = sealDeployment(source, "compiled", {
    typeDefs: "type Query { value: Int! }",
    fields: ["value"],
  });
  assert.equal(verifyDeployment(artifact), undefined);
  for (const key of ["source", "bundle", "typeDefs", "runtime"] as const)
    assert.throws(
      () => verifyDeployment({ ...artifact, [key]: artifact[key] + " " }),
      /deployment_invalid/,
    );
  assert.ok(Object.isFrozen(artifact));
});
test("schema contract rejects subscriptions, ambiguous root names and manifest mismatch", () => {
  for (const typeDefs of [
    "type Query{x:Int} type Subscription{x:Int}",
    "type Query{x:Int} type Mutation{x:Int}",
    "type Query{other:Int}",
    `type Query{x:${"[".repeat(100)}Int${"]".repeat(100)}}`,
  ])
    assert.throws(
      () => sealDeployment(source, "compiled", { typeDefs, fields: ["x"] }),
      /schema_rejected/,
    );
});
test("invalid input and preaborted work fail before container startup", async () => {
  const host = createBackendHost({ image: "deliberately-absent-image" });
  await assert.rejects(host.compile("x".repeat(262145)), /source_quota/);
  await assert.rejects(host.compile(source, AbortSignal.abort()), /cancelled/);
  const artifact = sealDeployment(source, "compiled", {
    typeDefs: "type Query{value:Int}",
    fields: ["value"],
  });
  await assert.rejects(
    host.invoke(
      { deployment: artifact, principal: { tenant: "t", subject: "u" }, input: { field: "absent", args: null }, env: {}, reuse: { kind: "one-shot" } },
    ),
    /field_rejected/,
  );
  await assert.rejects(
    host.invoke(
      { deployment: artifact, principal: { tenant: "t", subject: "u" }, input: { field: "value", args: "x".repeat(65537) }, env: {}, reuse: { kind: "one-shot" } },
    ),
    /input_quota/,
  );
});
