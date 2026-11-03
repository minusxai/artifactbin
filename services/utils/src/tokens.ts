import { createHash } from 'node:crypto';

/** The shape of a presented bearer token. Checked before anything is hashed or queried. */
export const TOKEN_RE = /^mx_[A-Za-z0-9_-]{40,50}$/;
export const hashToken = (presented: string): string => createHash('sha256').update(presented).digest('hex');
