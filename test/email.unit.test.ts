import { test } from "node:test";
import assert from "node:assert/strict";
import { emailAddress, requestCode, verifyCode } from "../src/email.ts";
test("email identity, resend cooldown, hourly cap, expiry, guesses and single use", () => {
  assert.equal(emailAddress(" Person@Example.com "), "person@example.com");
  assert.throws(() => emailAddress("x\r\n@example.com"));
  let c = requestCode(undefined, 1000, "digest", "salt");
  assert.throws(() => requestCode(c, 1001, "other", "salt"), /Wait/);
  assert.equal(verifyCode(c, 1001, "wrong").verified, false);
  for (let i = 0; i < 5; i++) c = verifyCode(c, 1001, "wrong").challenge;
  assert.equal(verifyCode(c, 1001, "digest").verified, false);
  c = requestCode(c, 61001, "new", "salt2");
  assert.equal(verifyCode(c, 661002, "new").verified, false);
  const result = verifyCode(c, 61002, "new");
  assert.equal(result.verified, true);
  assert.equal(verifyCode(result.challenge, 61003, "new").verified, false);
  for (let i = 2; i < 5; i++)
    c = requestCode(c, 1000 + i * 61000, "new", "salt");
  assert.throws(() => requestCode(c, 400000, "new", "salt"), /hour/);
  assert.doesNotThrow(() => requestCode(c, 3601001, "new", "salt"));
});
