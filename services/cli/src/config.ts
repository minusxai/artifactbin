import {validVersion} from './version-order';
import { readFile } from "node:fs/promises";
import { atomicWrite, digest, privateDirectory } from "./files";
import { homedir } from "node:os";
import { join } from "node:path";

/** Where afbin talks when nothing selects a server. */
export const DEFAULT_SERVER = "https://artifactbin.dev";
/** Client-only defaults. Reading or changing these never starts a server. */
export interface ClientDefaults { host?: string; output?: "text" | "json"; updates?: boolean }

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
  return join(hostDirectory(server, home, env), "credentials.env");
}
export function hostDirectory(server: string, home = homedir(), env: NodeJS.ProcessEnv = process.env): string {
  return join(configDir(home, env), 'hosts', digest(normalizeServer(server)).slice(0, 16));
}
export function normalizeHost(value: string): string {
  return normalizeServer(value);
}
export async function readClientDefaults(home = homedir(), env: NodeJS.ProcessEnv = process.env): Promise<ClientDefaults> {
  let value: ClientDefaults;
  try { value = JSON.parse(await readFile(join(configDir(home, env), 'config.json'), 'utf8')); }
  catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return {}; throw error; }
  if (!value || typeof value !== 'object' || Array.isArray(value)
    || Object.keys(value).some(key => !['host', 'output', 'updates'].includes(key))
    || (value.host !== undefined && typeof value.host !== 'string')
    || (value.output !== undefined && !['text', 'json'].includes(value.output))
    || (value.updates !== undefined && typeof value.updates !== 'boolean')) throw new Error('Invalid client config.json.');
  if (value.host !== undefined) value.host = normalizeHost(value.host);
  return value;
}
export async function setClientDefault(key: string, value: string, home = homedir(), env: NodeJS.ProcessEnv = process.env): Promise<ClientDefaults> {
  const config = await readClientDefaults(home, env);
  if (key === 'host') config.host = normalizeHost(value);
  else if (key === 'output' && (value === 'text' || value === 'json')) config.output = value;
  else if (key === 'updates' && (value === 'true' || value === 'false')) config.updates = value === 'true';
  else throw new Error('Use host <origin>, output text|json, or updates true|false.');
  await privateDirectory(configDir(home, env));
  await atomicWrite(join(configDir(home, env), 'config.json'), JSON.stringify(config, null, 2) + '\n');
  return config;
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
/** Client defaults never read server settings or implicitly follow a login. */
export async function exportedServer(home = homedir(), env: NodeJS.ProcessEnv = process.env): Promise<string | undefined> {
  const selected = env.ARTIFACTBIN_URL ?? (await readClientDefaults(home, env)).host;
  return selected ? normalizeHost(selected) : undefined;
}
/** The installer may seed a first default; an existing explicit preference wins. */
export async function saveDefaultServer(server: string, home = homedir(), env: NodeJS.ProcessEnv = process.env): Promise<void> {
  const normalized = normalizeHost(server);
  if (normalized === DEFAULT_SERVER || (await readClientDefaults(home, env)).host) return;
  await setClientDefault('host', normalized, home, env);
}
export async function loadConnection(
  server?: string,
  home = homedir(),
  env: NodeJS.ProcessEnv = process.env,
): Promise<Connection | null> {
  const selectedHost = server ?? await exportedServer(home, env) ?? DEFAULT_SERVER;
  const selected = normalizeServer(selectedHost);
  if (env.ARTIFACTBIN_TOKEN) {
    const explicitServer = normalizeHost(env.ARTIFACTBIN_URL ?? DEFAULT_SERVER);
    return explicitServer === selected ? { server: selected, token: env.ARTIFACTBIN_TOKEN } : null;
  }
  const saved = await readEnvFile(credentialPath(selected, home, env));
  if (saved.ARTIFACTBIN_URL !== selected) return null;
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
  const dir = hostDirectory(server, home, env);
  await privateDirectory(dir);
  const profilePath = join(dir, 'profile.json');
  let profile: {url: string; alias?: string} = {url: server};
  try { profile = {...JSON.parse(await readFile(profilePath, 'utf8')), url: server}; }
  catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
  await atomicWrite(profilePath, JSON.stringify(profile, null, 2) + '\n');
  const path = credentialPath(server, home, env);
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

/** Automatic checks are opt-out; a version pin disables background changes entirely. */
export function autoUpdatePolicy(env:NodeJS.ProcessEnv=process.env):{enabled:boolean;pin?:string} {
 const pin=env.CLI__VERSION_PIN;
 return {enabled:!['0','false','off'].includes((env.CLI__AUTO_UPDATE??'').toLowerCase())&&!pin,...(pin?{pin:validVersion(pin)?pin:'invalid'}:{})};
}
