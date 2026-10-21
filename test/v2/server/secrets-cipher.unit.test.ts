/** Account secrets at rest (src/server/secrets.ts): the key, and ciphertexts bound to one account and name. */
import { test } from "node:test";
import assert from "node:assert/strict";
import type { SecretsModule } from "../../../src/server/secrets-contracts.ts";
import { load } from "../support/load.ts";

const secrets = () => load<SecretsModule>("src/server/secrets.ts");
const HEX = "0123456789abcdef".repeat(4);

test("the key is 32 bytes as hex, base64 or base64url; anything else is refused", async () => {
  const { parseSecretsKey } = await secrets();
  const bytes = Buffer.from(HEX, "hex");
  assert.deepEqual(Buffer.from(parseSecretsKey(HEX)), bytes);
  assert.deepEqual(Buffer.from(parseSecretsKey(HEX.toUpperCase())), bytes);
  assert.deepEqual(Buffer.from(parseSecretsKey(bytes.toString("base64"))), bytes);
  assert.deepEqual(Buffer.from(parseSecretsKey(bytes.toString("base64url"))), bytes);
  assert.deepEqual(Buffer.from(parseSecretsKey(` ${HEX}\n`)), bytes, "surrounding whitespace is ignored");
  for (const bad of ["", "abc", HEX.slice(0, 62), Buffer.alloc(16).toString("base64"), Buffer.alloc(33).toString("base64"), "not base64 at all!!"])
    assert.throws(() => parseSecretsKey(bad), /PAGEGI_SECRETS_KEY/, JSON.stringify(bad));
});

test("a sealed value opens only under the same key, account and name, and never repeats a ciphertext", async () => {
  const { parseSecretsKey, createSecretCipher } = await secrets();
  const cipher = createSecretCipher(parseSecretsKey(HEX));
  const sealed = cipher.seal("alice@example.test", "STRIPE_KEY", "sk_live_1");
  assert.ok(!sealed.includes("sk_live_1"));
  assert.equal(cipher.open("alice@example.test", "STRIPE_KEY", sealed), "sk_live_1");
  assert.notEqual(cipher.seal("alice@example.test", "STRIPE_KEY", "sk_live_1"), sealed, "a fresh nonce every time");
  assert.throws(() => cipher.open("bob@example.test", "STRIPE_KEY", sealed), "another account's row");
  assert.throws(() => cipher.open("alice@example.test", "OTHER", sealed), "another name");
  assert.throws(() => cipher.open("alice@example.test", "STRIPE_KEY", sealed.slice(0, -2) + "AA"), "a tampered tag");
  assert.throws(() => cipher.open("alice@example.test", "STRIPE_KEY", "garbage"));
  const other = createSecretCipher(parseSecretsKey("f".repeat(64)));
  assert.throws(() => other.open("alice@example.test", "STRIPE_KEY", sealed), "another key");
  const unicode = "pässwörd ✓ ".repeat(300);
  assert.equal(cipher.open("a", "N", cipher.seal("a", "N", unicode)), unicode);
});
