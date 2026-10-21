import assert from "node:assert/strict";
import { test } from "node:test";
import { createBackendHost } from "../../../src/backend/container-host.ts";
import { deploymentIdentity } from "../../../src/backend/deployment-identity.ts";

test("legacy identifiers are preserved while independent deployments cannot select each other's containers", () => {
  const legacy = deploymentIdentity();
  const isolated = deploymentIdentity("artefactv2");
  assert.equal(legacy.filter, "label=pagegi.backend=1");
  assert.equal(legacy.network, "pagegi-sandbox");
  assert.equal(legacy.bridge, "pagegi-sbx");
  assert.equal(isolated.bridge, "artefactv2-sb");
  const uuid = "01234567-89ab-cdef-0123-456789abcdef";
  for (const identity of [legacy, isolated]) {
    assert.ok(identity.name.test(identity.namePrefix + uuid));
    assert.ok(identity.bridge.length <= 15);
  }
  assert.ok(!legacy.name.test(isolated.namePrefix + uuid));
  assert.ok(!isolated.name.test(legacy.namePrefix + uuid));
  assert.notEqual(legacy.filter, isolated.filter);
  assert.notEqual(legacy.network, isolated.network);
});

test("deployment identity refuses shell, Docker option, regex and path injection", () => {
  for (const value of [
    "",
    "--name",
    "../a",
    "a.*",
    "a;b",
    "a b",
    "A",
    "a".repeat(13),
  ])
    assert.throws(() => deploymentIdentity(value), /namespace/);
});

test("backend host validates its deployment identity before admitting work", () => {
  assert.throws(
    () => createBackendHost({ deploymentNamespace: "../other" }),
    /namespace/,
  );
});
