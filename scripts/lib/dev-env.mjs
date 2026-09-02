/**
 * Env plumbing shared by the node-side dev scripts (scripts/dev.mjs, mint.mjs).
 *
 * The dev server's port is DERIVED, not hard-coded, so two checkouts of this
 * repo can run side by side: `PORT` wins, else the port in `PUBLIC_BASE_URL`
 * (the one URL a second checkout must change anyway — every absolute link the
 * app emits comes from it), else 3030.
 *
 * This derivation lives HERE and never in lib/config.ts: it turns an
 * externally-visible ORIGIN into a local BIND port, which is only ever true in
 * dev. In production PUBLIC_BASE_URL has no port at all.
 */
import { readFileSync } from 'node:fs';

/** The historical port, kept as the fallback so nothing changes by default. */
export const DEFAULT_DEV_PORT = 3030;

/** Loads .env into process.env without clobbering real env vars. */
export function loadDotEnv() {
  try {
    for (const line of readFileSync(new URL('../../.env', import.meta.url), 'utf8').split('\n')) {
      const m = line.match(/^\s*([A-Z_][A-Z0-9_]*)\s*=\s*(.*)\s*$/);
      if (m && !(m[1] in process.env)) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
    }
  } catch {
    /* no .env — fine */
  }
}

/**
 * The port `next dev` should bind, given an env-shaped object.
 * @param {Record<string, string | undefined>} [env]
 */
export function resolvePort(env = process.env) {
  const explicit = Number(env.APP__PORT);
  if (Number.isInteger(explicit) && explicit > 0 && explicit < 65536) return explicit;
  return declaredPort(env) ?? DEFAULT_DEV_PORT;
}

/** Vite's websocket uses an explicit override or the adjacent port. */
export function resolveHmrPort(appPort, env = process.env) {
  const explicit = Number(env.APP__HMR_PORT);
  return Number.isInteger(explicit) && explicit > 0 && explicit < 65536 ? explicit : appPort + 1;
}

/**
 * The port PUBLIC_BASE_URL spells out, or null. Only an EXPLICIT port counts:
 * URL.port is '' for a scheme's default, and a production PUBLIC_BASE_URL
 * (https://artifactbin.dev) must never mean "bind 443".
 * @param {Record<string, string | undefined>} [env]
 */
export function declaredPort(env = process.env) {
  const port = Number(parseUrl(env.APP__PUBLIC_BASE_URL)?.port);
  return port > 0 ? port : null;
}

/**
 * Origin the dev-side HTTP clients (mint) should talk to.
 * @param {Record<string, string | undefined>} [env]
 */
export function resolveBaseUrl(env = process.env) {
  return env.BASE_URL ?? env.APP__PUBLIC_BASE_URL ?? `http://localhost:${resolvePort(env)}`;
}

/** @param {string | undefined} value */
function parseUrl(value) {
  try {
    return new URL(value);
  } catch {
    return null;
  }
}
