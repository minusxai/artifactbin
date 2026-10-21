import test from "node:test";
import assert from "node:assert/strict";
import { createPolicy, challengeFor, route } from "./policy.mjs";
const verifier = "v".repeat(48),
  request = {
    documentId: "a",
    channel: "c".repeat(32),
    challenge: challengeFor(verifier),
  };
function setup() {
  let now = 0;
  return { p: createPolicy(() => now), advance: (n) => (now = n) };
}
test("account required and bounded request fields", () => {
  const { p } = setup();
  for (const r of [
    request,
    { ...request, documentId: "other" },
    { ...request, channel: "" },
    { ...request, challenge: "bad" },
  ])
    assert.throws(() => p.issue(undefined, r));
  assert.throws(() =>
    p.issue("fixture-account", { ...request, documentId: "other" }),
  );
  assert.throws(() => p.issue("fixture-account", { ...request, channel: "" }));
  assert.throws(() =>
    p.issue("fixture-account", { ...request, challenge: "bad" }),
  );
});
test("grant binds document, channel, verifier, single use; wrong attempts do not consume", () => {
  const { p } = setup(),
    g = p.issue("fixture-account", request);
  for (const delta of [
    { documentId: "b" },
    { channel: "d".repeat(32) },
    { verifier: "wrong" },
  ])
    assert.throws(() =>
      p.redeem({ ...request, code: g.code, verifier, ...delta }),
    );
  const s = p.redeem({ ...request, code: g.code, verifier });
  assert.equal(p.authorize(s.token, "a"), true);
  assert.equal(p.authorize(s.token, "b"), false);
  assert.throws(() => p.redeem({ ...request, code: g.code, verifier }));
});
test("expiry exact boundary and revocation invalidate grants and sessions", () => {
  let { p, advance } = setup();
  let g = p.issue("fixture-account", request);
  advance(60000);
  assert.throws(() => p.redeem({ ...request, code: g.code, verifier }));
  ({ p, advance } = setup());
  g = p.issue("fixture-account", request);
  let s = p.redeem({ ...request, code: g.code, verifier });
  advance(300000);
  assert.equal(p.authorize(s.token, "a"), false);
  ({ p } = setup());
  g = p.issue("fixture-account", request);
  s = p.redeem({ ...request, code: g.code, verifier });
  const g2 = p.issue("fixture-account", request);
  p.revoke();
  assert.equal(p.authorize(s.token, "a"), false);
  assert.throws(() => p.redeem({ ...request, code: g2.code, verifier }));
});
test("routing rejects foreign hosts and denies all private representations without scoped auth", () => {
  for (const representation of ["source", "raw", "history", "shell"]) {
    assert.equal(
      route("platform.test", `/docs/a/${representation}`, false).status,
      403,
    );
    assert.equal(
      route("platform.test", `/docs/a/${representation}`, true).status,
      200,
    );
    assert.equal(
      route("doc-a.content.test", `/docs/a/${representation}`, true).status,
      404,
    );
  }
  assert.equal(route("evil.test", "/docs/a/source", true).status, 421);
  assert.equal(route("doc-a.content.test", "/app/b", true).status, 404);
  assert.equal(route("doc-a.content.test", "/app/a", false).status, 403);
  assert.equal(route("doc-a.content.test", "/app/a", true).status, 200);
});
import { acceptChromeOffer } from "./policy.mjs";
test("any exact parent may own chrome, including opaque parent; offer confers zero auth", () => {
  const parent = {},
    data = {
      type: "chrome-offer",
      version: 1,
      channel: "c",
      topbar: true,
      modals: true,
    };
  for (const origin of ["https://third-party.test", "null"]) {
    const owner = acceptChromeOffer(
      { source: parent, origin, data },
      parent,
      "c",
    );
    assert.equal(owner.origin, origin);
    assert.equal(setup().p.authorize(owner, "a"), false);
  }
  for (const event of [
    { source: {}, origin: "null", data },
    { source: parent, origin: "null", data: { ...data, version: 2 } },
    { source: parent, origin: "null", data: { ...data, channel: "old" } },
    { source: parent, origin: "null", data: { ...data, topbar: "yes" } },
  ])
    assert.equal(acceptChromeOffer(event, parent, "c"), null);
});
import { createChromeNegotiation } from "./policy.mjs";
test("chrome negotiation latches once, ignores late/sibling offers and defaults local at exact deadline", () => {
  const parent = {},
    data = {
      type: "chrome-offer",
      version: 1,
      channel: "session",
      topbar: true,
      modals: false,
    },
    event = { source: parent, origin: "https://any-vendor.test", data };
  let n = createChromeNegotiation(parent, "session", 100);
  assert.equal(n.mode(99), "waiting");
  assert.equal(n.receive({ ...event, source: {} }, 1), null);
  assert.ok(n.receive(event, 99));
  assert.equal(n.receive(event, 99), null);
  assert.equal(n.mode(100), "parent");
  n = createChromeNegotiation(parent, "session", 100);
  assert.equal(n.receive(event, 100), null);
  assert.equal(n.mode(100), "local");
});
