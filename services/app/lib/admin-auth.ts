/** Operator credential shared by admin-only HTTP doors. Invalid/unset is always absent (404). */
import crypto from 'crypto';
import { env } from './config';
import { sha256 } from './tokens';

export function hasAdminCredential(request: Request): boolean {
  const secret = env('ADMIN', 'SECRET');
  if (!secret) return false;
  const bearer = request.headers.get('authorization')?.replace(/^Bearer\s+/i, '').trim() ?? '';
  const presented = request.headers.get('x-shared-secret') ?? bearer;
  if (!presented) return false;
  const a = Buffer.from(sha256(presented), 'hex');
  const b = Buffer.from(sha256(secret), 'hex');
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}
