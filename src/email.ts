import type { EmailChallenge, EmailVerification } from "./identity-data-contracts.ts";
import { fail } from "./errors.ts";
export function emailAddress(input: unknown): string {
  if (typeof input !== "string" || /[\r\n]/.test(input))
    fail(400, "Enter a valid email address");
  const email = (input as string).trim().toLowerCase();
  if (email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))
    fail(400, "Enter a valid email address");
  return email;
}
export function requestCode(
  previous: EmailChallenge | undefined,
  now: number,
  digest: string,
  salt: string,
): EmailChallenge {
  if (previous && now - previous.sentAt < 60000)
    fail(429, "Wait a minute before requesting another code");
  const sameWindow = previous && now - previous.windowStart < 3600000;
  if (sameWindow && previous.sends >= 5)
    fail(429, "Too many codes requested. Try again in an hour");
  return {
    digest,
    salt,
    expires: now + 600000,
    attempts: 0,
    sentAt: now,
    windowStart: sameWindow ? previous.windowStart : now,
    sends: sameWindow ? previous.sends + 1 : 1,
  };
}
export function verifyCode(
  challenge: EmailChallenge,
  now: number,
  digest: string,
): EmailVerification {
  const verified =
    challenge.expires > now &&
    challenge.attempts < 5 &&
    challenge.digest === digest;
  return {
    verified,
    challenge: {
      ...challenge,
      attempts: challenge.attempts + 1,
      ...(verified ? { expires: 0, digest: "" } : {}),
    },
  };
}
