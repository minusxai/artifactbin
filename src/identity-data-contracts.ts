import type { Id } from "./contracts.ts";

export interface Account {
  name?: string;
  image?: string | null;
  salt?: string;
  password?: string;
}
export interface SessionGrant {
  /** Transaction-local fresh group facts; never persisted in sessions. */
  groupAuthority?: import("./group-authority-contracts.ts").GroupAuthorityFacts;
  /** Account sessions omit purpose; scoped grants never inherit another purpose. */
  purpose?: "collaboration" | "document" | "backend";
  /** Backend grants authorize only this immutable deployment version. */
  backendVersion?: string;
  actor: string;
  fileId: Id | null;
  generation: number | null;
  expires: number;
}
/** Email challenges contain only salted digests; delivery and randomness are adapters. */
export interface EmailChallenge {
  digest: string;
  salt: string;
  expires: number;
  attempts: number;
  sentAt: number;
  windowStart: number;
  sends: number;
}
export interface EmailDeliveryPort {
  sendCode(message: { to: string; code: string }): Promise<void>;
}
export interface EmailVerification {
  challenge: EmailChallenge;
  verified: boolean;
}
