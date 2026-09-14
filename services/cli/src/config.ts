import { readFile } from "node:fs/promises";
import { atomicWrite, digest, privateDirectory } from "./files";
import { homedir } from "node:os";
import { join } from "node:path";

/** Where afbin talks when nothing selects a server. */
export const DEFAULT_SERVER = "https://artifactbin.dev";
export interface Connection {
  server: string;
  token: string;
  refreshToken?: string;
  clientId?: string;
  expiresAt?: number;
}
/** The CLI's private state directory: `~/.artifactbin`, or `ARTIFACTBIN_HOME` when set. Skills never live here. */
export function configDir(home = homedir(), env: NodeJS.ProcessEnv = process.env): string {
  return env.ARTIFACTBIN_HOME ? env.ARTIFACTBIN_HOME : join(home, ".artifactbin");
}
/** Credentials are kept per origin, so switching servers never re-prompts or overwrites another origin's token. */
function credentialPath(server: string, home = homedir(), env: NodeJS.ProcessEnv = process.env): string {
  return join(configDir(home, env), "servers", `${digest(server).slice(0, 16)}.env`);
}
const CREDENTIAL_KEYS = /^\s*(?:export\s+)?(ARTIFACTBIN_URL|ARTIFACTBIN_TOKEN|ARTIFACTBIN_REFRESH_TOKEN|ARTIFACTBIN_CLIENT_ID|ARTIFACTBIN_EXPIRES_AT)\s*=\s*(.*?)\s*$/;
async function readEnvFile(path: string): Promise<Record<string, string>> {
  const saved: Record<string, string> = {};
  try {
    for (const line of (await readFile(path, "utf8")).split(/\r?\n/)) {
      const match = line.match(CREDENTIAL_KEYS);
      if (match) saved[match[1]] = match[2].replace(/^(['"])(.*)\1$/, "$2");
    }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
  return saved;
}
export function normalizeServer(value: string): string {
  const url = new URL(value);
  const local = ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);
  if (
    (url.protocol !== "https:" && !(url.protocol === "http:" && local)) ||
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    url.pathname !== "/"
  )
    throw new Error(
      "Use an HTTPS server origin, or HTTP localhost for development.",
    );
  return url.origin;
}
/**
 * The origin afbin talks to when nothing selects one: the environment, else the default recorded in
 * `.env` (an installer served from a self-hosted origin records it through `afbin setup --server`),
 * else the public server.
 */
export async function defaultServer(home = homedir(), env: NodeJS.ProcessEnv = process.env): Promise<string> {
  const primary = await readEnvFile(join(configDir(home, env), ".env"));
  return normalizeServer(env.ARTIFACTBIN_URL ?? primary.ARTIFACTBIN_URL ?? DEFAULT_SERVER);
}
/**
 * Record `server` as the default origin, without credentials. A first origin only: once `.env` names
 * one, it stays (the same rule saveConnection keeps), and the public server needs no record at all.
 * Before this, a CLI installed from a self-hosted origin still published to artifactbin.dev by default
 * (eval run local17, codex report: the first `afbin push data.csv` went to the public server, anonymously).
 */
export async function saveDefaultServer(server: string, home = homedir(), env: NodeJS.ProcessEnv = process.env): Promise<void> {
  const normalized = normalizeServer(server);
  if (normalized === DEFAULT_SERVER) return;
  const dir = configDir(home, env);
  const primary = await readEnvFile(join(dir, ".env"));
  if (primary.ARTIFACTBIN_URL) return;
  await privateDirectory(dir);
  await atomicWrite(join(dir, ".env"), `ARTIFACTBIN_URL=${normalized}\n`);
}
export async function loadConnection(
  server?: string,
  home = homedir(),
  env: NodeJS.ProcessEnv = process.env,
): Promise<Connection | null> {
  const dir = configDir(home, env);
  // `.env` names the default origin and holds its credentials; every other origin has its own file.
  const primary = await readEnvFile(join(dir, ".env"));
  const defaultServer = normalizeServer(env.ARTIFACTBIN_URL ?? primary.ARTIFACTBIN_URL ?? DEFAULT_SERVER);
  const selected = normalizeServer(server ?? defaultServer);
  if (env.ARTIFACTBIN_TOKEN) {
    // An explicit token is scoped to the explicit origin (or the default) and never inherits refresh credentials.
    const explicitServer = normalizeServer(env.ARTIFACTBIN_URL ?? DEFAULT_SERVER);
    return explicitServer === selected ? { server: selected, token: env.ARTIFACTBIN_TOKEN } : null;
  }
  const saved = primary.ARTIFACTBIN_URL && normalizeServer(primary.ARTIFACTBIN_URL) === selected ? primary : await readEnvFile(credentialPath(selected, home, env));
  const token = saved.ARTIFACTBIN_TOKEN;
  if (!token) return null;
  const refreshed = saved.ARTIFACTBIN_REFRESH_TOKEN && saved.ARTIFACTBIN_CLIENT_ID;
  const expiresAt = Number(saved.ARTIFACTBIN_EXPIRES_AT);
  return { server: selected, token, ...(refreshed ? {
    refreshToken: saved.ARTIFACTBIN_REFRESH_TOKEN, clientId: saved.ARTIFACTBIN_CLIENT_ID,
    ...(Number.isSafeInteger(expiresAt) && expiresAt > 0 ? {expiresAt} : {}),
  } : {}) };
}
export async function saveConnection(
  connection: Connection,
  home = homedir(),
  env: NodeJS.ProcessEnv = process.env,
): Promise<void> {
  const server = normalizeServer(connection.server);
  if (!/^[A-Za-z0-9_-]+$/.test(connection.token))
    throw new Error("Invalid token format");
  for (const value of [connection.refreshToken, connection.clientId]) {
    if (value !== undefined && !/^[A-Za-z0-9_-]+$/.test(value)) throw new Error("Invalid refresh credential format");
  }
  if (connection.expiresAt !== undefined && (!Number.isSafeInteger(connection.expiresAt) || connection.expiresAt <= 0)) throw new Error("Invalid credential expiry");
  const dir = configDir(home, env);
  await privateDirectory(dir);
  const primary = await readEnvFile(join(dir, ".env"));
  // The first origin ever saved becomes the default; later origins are stored beside it, never over it.
  const isDefault = !primary.ARTIFACTBIN_URL || normalizeServer(primary.ARTIFACTBIN_URL) === server;
  const path = isDefault ? join(dir, ".env") : credentialPath(server, home, env);
  if (!isDefault) await privateDirectory(join(dir, "servers"));
  const values = { ARTIFACTBIN_URL: server, ARTIFACTBIN_TOKEN: connection.token,
    ARTIFACTBIN_REFRESH_TOKEN: connection.refreshToken, ARTIFACTBIN_CLIENT_ID: connection.clientId, ARTIFACTBIN_EXPIRES_AT: connection.expiresAt };
  await atomicWrite(path, Object.entries(values).filter(([,value]) => value !== undefined).map(([key,value]) => `${key}=${value}\n`).join(''));
}

/** Optional service mirror changes transport only; the executable still pins every package checksum. */
export function servicePackageUrl(releaseUrl:string,env:NodeJS.ProcessEnv=process.env):string{
 if(!env.CLI__SERVICE_BASE_URL)return releaseUrl;
 const path=new URL(releaseUrl).pathname.split('/').slice(-2).join('/');
 const base=new URL(env.CLI__SERVICE_BASE_URL),origin=normalizeServer(base.origin);
 if(base.username||base.password||base.search||base.hash)throw new Error('Use a service base URL without credentials, query or fragment.');
 return `${origin}${base.pathname.replace(/\/+$/,'')}/${path}`;
}
