import { readFile } from "node:fs/promises";
import { atomicWrite, privateDirectory } from "./files";
import { homedir } from "node:os";
import { join } from "node:path";
export interface Connection {
  server: string;
  token: string;
  refreshToken?: string;
  clientId?: string;
  expiresAt?: number;
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
export async function loadConnection(
  server?: string,
  home = homedir(),
  env: NodeJS.ProcessEnv = process.env,
): Promise<Connection | null> {
  let saved: Record<string, string> = {};
  try {
    const raw = await readFile(join(home, ".artifactbin", ".env"), "utf8");
    for (const line of raw.split(/\r?\n/)) {
      const match = line.match(
        /^\s*(?:export\s+)?(ARTIFACTBIN_URL|ARTIFACTBIN_TOKEN|ARTIFACTBIN_REFRESH_TOKEN|ARTIFACTBIN_CLIENT_ID|ARTIFACTBIN_EXPIRES_AT)\s*=\s*(.*?)\s*$/,
      );
      if (match) saved[match[1]] = match[2].replace(/^(['"])(.*)\1$/, "$2");
    }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
  const storedServer = normalizeServer(
    env.ARTIFACTBIN_TOKEN
      ? (env.ARTIFACTBIN_URL ?? "https://artifactbin.dev")
      : (saved.ARTIFACTBIN_URL ?? "https://artifactbin.dev"),
  );
  const selected = normalizeServer(
    server ?? env.ARTIFACTBIN_URL ?? storedServer,
  );
  const token = env.ARTIFACTBIN_TOKEN ?? saved.ARTIFACTBIN_TOKEN;
  if (!token || storedServer !== selected) return null;
  const refreshed = !env.ARTIFACTBIN_TOKEN && saved.ARTIFACTBIN_REFRESH_TOKEN && saved.ARTIFACTBIN_CLIENT_ID;
  const expiresAt = Number(saved.ARTIFACTBIN_EXPIRES_AT);
  return { server: selected, token, ...(refreshed ? {
    refreshToken: saved.ARTIFACTBIN_REFRESH_TOKEN, clientId: saved.ARTIFACTBIN_CLIENT_ID,
    ...(Number.isSafeInteger(expiresAt) && expiresAt > 0 ? {expiresAt} : {}),
  } : {}) };
}
export async function saveConnection(
  connection: Connection,
  home = homedir(),
): Promise<void> {
  const server = normalizeServer(connection.server);
  if (!/^[A-Za-z0-9_-]+$/.test(connection.token))
    throw new Error("Invalid token format");
  for (const value of [connection.refreshToken, connection.clientId]) {
    if (value !== undefined && !/^[A-Za-z0-9_-]+$/.test(value)) throw new Error("Invalid refresh credential format");
  }
  if (connection.expiresAt !== undefined && (!Number.isSafeInteger(connection.expiresAt) || connection.expiresAt <= 0)) throw new Error("Invalid credential expiry");
  const path = join(home, ".artifactbin", ".env");
  await privateDirectory(join(home, ".artifactbin"));
  const values = { ARTIFACTBIN_URL: server, ARTIFACTBIN_TOKEN: connection.token,
    ARTIFACTBIN_REFRESH_TOKEN: connection.refreshToken, ARTIFACTBIN_CLIENT_ID: connection.clientId, ARTIFACTBIN_EXPIRES_AT: connection.expiresAt };
  await atomicWrite(path, Object.entries(values).filter(([,value]) => value !== undefined).map(([key,value]) => `${key}=${value}\n`).join(''));
}
