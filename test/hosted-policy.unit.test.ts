import test from "node:test";
import assert from "node:assert/strict";
import { hostedRequest, runnerAddress } from "../src/hosted-policy.ts";
test("configured origin authority rejects spoofed host/proxy headers and isolates document origins", () => {
  const config = {
    platformOrigin: "https://platform.example",
    runnerOrigin: "https://{document}.apps.example",
  };
  assert.deepEqual(hostedRequest("platform.example", 443, config), {
    kind: "platform",
    origin: "https://platform.example",
  });
  assert.deepEqual(hostedRequest("abc.apps.example", 443, config), {
    kind: "runner",
    origin: "https://abc.apps.example",
    document: "abc",
  });
  for (const host of [
    "evil.example",
    "platform.example.evil.test",
    "apps.example",
    "abc.def.apps.example",
    "platform.example:80",
    "user@platform.example",
  ])
    assert.throws(() => hostedRequest(host, 443, config));
  assert.equal(runnerAddress("abc", config), "https://abc.apps.example/runner");
  assert.notEqual(runnerAddress("abc", config), runnerAddress("def", config));
  for (const bad of ["../bad", "a.b", "", "A"])
    assert.throws(() => runnerAddress(bad, config));
  assert.throws(() =>
    hostedRequest("platform.example", 443, {
      ...config,
      runnerOrigin: "https://{document}.platform.example",
    }),
  );
});
test("development accepts only actual loopback listener and exact port", () => {
  assert.equal(
    hostedRequest("127.0.0.1:1234", 1234, {}).origin,
    "http://127.0.0.1:1234",
  );
  assert.equal(
    hostedRequest("localhost:1234", 1234, {}).origin,
    "http://localhost:1234",
  );
  for (const host of [
    "evil.test:1234",
    "127.0.0.1:55",
    "127.0.0.1.evil.test:1234",
  ])
    assert.throws(() => hostedRequest(host, 1234, {}));
});
