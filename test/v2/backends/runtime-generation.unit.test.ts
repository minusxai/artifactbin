/**
 * A backend's version names what its viewers call: its source and schema.
 * The executor image it was compiled on is recorded but is not part of it, so
 * rebuilding the image (or recompiling for a new runtime) keeps the version.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import {
  BACKEND_RUNTIME,
  isCurrentRuntime,
  sealDeployment,
  verifyDeployment,
} from "../../../src/backend/deployment.ts";

const SOURCE = "export const typeDefs = 'type Query { value: Int! }';";
const metadata = (runtime: string) => ({
  typeDefs: "type Query { value: Int! }",
  fields: ["value"],
  runtime,
});
const image = (c: string) => "/image:sha256:" + c.repeat(64);

test("the same source compiled on two images has one version", () => {
  const a = sealDeployment(SOURCE, "bundle", metadata(BACKEND_RUNTIME + image("a")));
  const b = sealDeployment(SOURCE, "bundle built elsewhere", metadata(BACKEND_RUNTIME + image("b")));
  assert.equal(a.version, b.version);
  verifyDeployment(a);
  verifyDeployment(b);
  const changed = sealDeployment(SOURCE + " ", "bundle", metadata(BACKEND_RUNTIME + image("a")));
  assert.notEqual(changed.version, a.version, "a source change is a new version");
  const reschema = sealDeployment(SOURCE, "bundle", {
    ...metadata(BACKEND_RUNTIME),
    typeDefs: "type Query { value: Int! other: Int }",
    fields: ["other", "value"],
  });
  assert.notEqual(reschema.version, a.version, "a schema change is a new version");
});

test("tampering is still caught although the version no longer hashes the bundle", () => {
  const a = sealDeployment(SOURCE, "bundle", metadata(BACKEND_RUNTIME + image("a")));
  for (const key of ["bundle", "bundleHash", "source", "typeDefs", "runtime"] as const)
    assert.throws(() => verifyDeployment({ ...a, [key]: a[key] + " " }), /deployment_invalid/, key);
  assert.throws(() => verifyDeployment({ ...a, version: "f".repeat(64) }), /deployment_invalid/);
});

test("deployments stored before this change, versioned by their whole content, still verify", () => {
  const fresh = sealDeployment(SOURCE, "bundle", metadata(BACKEND_RUNTIME + image("a")));
  const { version: _ignored, ...content } = fresh;
  const legacy = {
    version: createHash("sha256").update(JSON.stringify(content)).digest("hex"),
    ...content,
  };
  assert.notEqual(legacy.version, fresh.version);
  assert.equal(verifyDeployment(legacy), undefined);
  assert.throws(() => verifyDeployment({ ...legacy, bundle: "other" }), /deployment_invalid/);
});

test("a runtime is current when its generation matches, whatever image it recorded", () => {
  assert.equal(isCurrentRuntime(BACKEND_RUNTIME), true);
  assert.equal(isCurrentRuntime(BACKEND_RUNTIME + image("c")), true);
  assert.equal(isCurrentRuntime(BACKEND_RUNTIME.replace("protocol@2", "protocol@1") + image("c")), true);
  assert.equal(isCurrentRuntime("workerd@1.0.0/esbuild@0.1.0/protocol@2" + image("c")), false);
  assert.equal(isCurrentRuntime(BACKEND_RUNTIME + "/image:latest"), false);
  assert.equal(isCurrentRuntime(BACKEND_RUNTIME + "-next"), false);
});
