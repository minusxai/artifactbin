/**
 * Identifiers.
 *
 * A FILE ID is the one identifier an artifact has: 6 chars of [a-zA-Z0-9],
 * serving as the API handle, the `ref:<id>` target, and the URL address
 * (/a/<id>) all at once. It is an ADDRESS, not a secret — read access is
 * decided by the visibility ACL (lib/artifacts.ts), never by id entropy.
 * Uniqueness comes from the primary key: at 62^6 (~57B) birthday collisions
 * are routine at scale, so createArtifact retries on 23505. ID_RE accepts a
 * RANGE (6-12) so longer ids can be minted later with no migration.
 *
 * INTERNAL ids (usr_/tok_) keep 96-bit base36 — they never appear in URLs
 * or refs, and tokens are handles for secrets, so extra entropy is free.
 */
import crypto from 'crypto';

export const FILE_ID_LENGTH = 6;
export { ID_RE } from './ids-shape';

const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';

export function generateFileId(): string {
  const out: string[] = [];
  while (out.length < FILE_ID_LENGTH) {
    // Rejection-sample so every symbol is equally likely (256 % 62 ≠ 0).
    for (const byte of crypto.randomBytes(FILE_ID_LENGTH)) {
      if (byte < 248 && out.length < FILE_ID_LENGTH) out.push(ALPHABET[byte % 62]);
    }
  }
  return out.join('');
}

/** 96 random bits as base36 (occasionally shorter on leading zeros). */
export function generateInternalId(): string {
  return BigInt('0x' + crypto.randomBytes(12).toString('hex')).toString(36);
}

export function generateTokenId(): string {
  return 'tok_' + BigInt('0x' + crypto.randomBytes(8).toString('hex')).toString(36);
}
