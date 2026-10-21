import {
  randomBytes,
  randomInt,
  scryptSync,
  timingSafeEqual,
} from "node:crypto";
import { hash } from "./text.ts";
import { fail } from "../errors.ts";
import type { Account, SessionGrant } from "../identity-data-contracts.ts";
import type { IdentityCrypto } from "./identity-repository-contracts.ts";

export const identityCrypto: IdentityCrypto = {
  token: () => randomBytes(32).toString("base64url"),
  code: () => String(randomInt(0, 1000000)).padStart(6, "0"),
  digest: hash,
  passwordDigest: (password, salt) =>
    scryptSync(password, salt, 64).toString("hex"),
  equalDigest: (actual, expected) => {
    const a = Buffer.from(actual, "hex"),
      b = Buffer.from(expected, "hex");
    return a.length === b.length && timingSafeEqual(a, b);
  },
};
export function accountActor(
  session: SessionGrant | null,
  now: number,
): string {
  if (!session || session.fileId || session.purpose || session.expires <= now)
    fail(401, "Sign in required");
  return session.actor;
}
export function passwordAccount(
  account: Account | null,
  password: unknown,
  crypto: IdentityCrypto,
): void {
  const computed = crypto.passwordDigest(
    String(password || ""),
    account?.salt || "missing",
  );
  if (!crypto.equalDigest(computed, account?.password || ""))
    fail(401, "Incorrect username or password");
}
export function newPasswordAccount(
  username: string,
  password: string,
  crypto: IdentityCrypto,
): Account {
  if (!/^[a-zA-Z0-9_-]{2,40}$/.test(username) || password.length < 12)
    throw Error(
      "Use a 2–40 character username and a password of at least 12 characters",
    );
  const salt = crypto.token();
  return { salt, password: crypto.passwordDigest(password, salt) };
}
/** An owned map keeps this policy local; the clock is supplied on each attempt. */
export function passwordAttempts() {
  const attempts = new Map<string, { count: number; start: number }>();
  return (peer: string, now: number): void => {
    for (const [key, rate] of attempts)
      if (now - rate.start > 60000) attempts.delete(key);
    const rate = attempts.get(peer) || { count: 0, start: now };
    attempts.set(peer, rate);
    if (++rate.count > 15) fail(429, "Wait a minute before trying again");
  };
}
