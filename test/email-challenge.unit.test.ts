import test from "node:test";
import assert from "node:assert/strict";
import { createEmailChallenge } from "../src/library-client/challenge.ts";
import type { EmailChallengeState } from "../src/library-client/challenge-contracts.ts";
const deferred = () => {
  let resolve!: () => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<void>((a, b) => {
    resolve = a;
    reject = b;
  });
  return { promise, resolve, reject };
};
function fixture() {
  const calls: string[] = [],
    states: EmailChallengeState[] = [];
  let sending = deferred(),
    verifying = deferred();
  const model = createEmailChallenge({
    send: async (email) => {
      calls.push("send:" + email);
      await sending.promise;
    },
    verify: async (email) => {
      calls.push("verify:" + email);
      await verifying.promise;
      return true;
    },
    cancel: () => calls.push("cancel"),
    changed: (s) => states.push(s),
    verified: () => {
      calls.push("verified");
    },
  });
  return { model, calls, states, sending, verifying };
}
test("reset invalidates stale send success and rejection without changing new form", async () => {
  for (const failure of [false, true]) {
    const f = fixture();
    const pending = f.model.submit("old", "");
    f.model.reset();
    if (failure) f.sending.reject(Error("old error"));
    else f.sending.resolve();
    await pending;
    assert.deepEqual(f.states.at(-1), {
      phase: "email",
      busy: false,
      message: "",
    });
  }
});
test("duplicate submit is ignored, successful send advances and verification completes once", async () => {
  const f = fixture();
  const sent = f.model.submit("a", "");
  await f.model.submit("a", "");
  assert.deepEqual(f.calls, ["send:a"]);
  f.sending.resolve();
  await sent;
  assert.equal(f.states.at(-1)?.phase, "code");
  const verify = f.model.submit("a", "123");
  f.verifying.resolve();
  await verify;
  assert.equal(f.calls.filter((c) => c === "verified").length, 1);
});
test("reset during verification cancels authority and suppresses verified callback", async () => {
  const f = fixture();
  f.sending.resolve();
  await f.model.submit("a", "");
  const v = f.model.submit("a", "123");
  f.model.reset();
  f.verifying.resolve();
  await v;
  assert.equal(f.calls.includes("cancel"), true);
  assert.equal(f.calls.includes("verified"), false);
});
test("send failure stays editable and resend never verifies", async () => {
  const f = fixture();
  const send = f.model.submit("a", "");
  f.sending.reject(Error("offline"));
  await send;
  assert.deepEqual(f.states.at(-1), {
    phase: "email",
    busy: false,
    message: "offline",
  });
  await f.model.resend("a");
  assert.equal(f.calls.length, 1);
});
test("resend preserves code phase, exposes failure, and reset suppresses old resend completion", async () => {
  let resolve!: () => void;
  let reject!: (e: unknown) => void;
  const states: EmailChallengeState[] = [];
  let count = 0;
  const c = createEmailChallenge({
    send: async () => {
      if (count++)
        await new Promise<void>((a, b) => {
          resolve = a;
          reject = b;
        });
    },
    verify: async () => false,
    cancel: () => {},
    changed: (s) => states.push(s),
    verified: () => {
      throw Error("must not verify");
    },
  });
  await c.submit("a", "");
  const failed = c.resend("a");
  reject(Error("retry later"));
  await failed;
  assert.deepEqual(states.at(-1), {
    phase: "code",
    busy: false,
    message: "retry later",
  });
  const pending = c.resend("a");
  c.reset();
  resolve();
  await pending;
  assert.deepEqual(states.at(-1), { phase: "email", busy: false, message: "" });
});
