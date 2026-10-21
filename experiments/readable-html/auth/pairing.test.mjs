import test from "node:test";
import assert from "node:assert/strict";
import { createPolicy, challengeFor } from "./policy.mjs";
import { createPairing } from "./pairing.mjs";
const verifier = "v".repeat(48),
  request = {
    documentId: "a",
    channel: "c".repeat(32),
    challenge: challengeFor(verifier),
  };
test("public pairing identifier cannot redeem; approved pairing remains verifier bound and single use", () => {
  const auth = createPolicy(() => 0),
    pairs = createPairing(auth, () => 0),
    r = pairs.begin(request);
  assert.equal(pairs.describe(r.requestId).documentId, "a");
  assert.equal(pairs.poll(r.requestId, verifier), null);
  assert.throws(() => pairs.approve(undefined, r.requestId));
  pairs.approve("fixture-account", r.requestId);
  assert.throws(() => pairs.poll(r.requestId, "attacker"));
  const session = pairs.poll(r.requestId, verifier);
  assert.ok(auth.authorize(session.token, "a"));
  assert.equal(auth.authorize(session.token, "b"), false);
  assert.throws(() => pairs.poll(r.requestId, verifier));
});
test("pairing expires at boundary, rejects malformed request, and revocation prevents redemption", () => {
  let now = 0;
  const auth = createPolicy(() => now),
    pairs = createPairing(auth, () => now);
  assert.throws(() => pairs.begin({ ...request, documentId: "other" }));
  const r = pairs.begin(request);
  pairs.approve("fixture-account", r.requestId);
  auth.revoke();
  assert.throws(() => pairs.poll(r.requestId, verifier));
  const r2 = pairs.begin(request);
  now = 60000;
  assert.throws(() => pairs.describe(r2.requestId));
  assert.throws(() => pairs.approve("fixture-account", r2.requestId));
  assert.throws(() => pairs.poll(r2.requestId, verifier));
});
