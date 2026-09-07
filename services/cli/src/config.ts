import { readFile, writeFile, rename, chmod } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
export interface Connection {
  server: string;
  token: string;
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
    const raw = await readFile(join(home, ".artifactbin.env"), "utf8");
    for (const line of raw.split(/\r?\n/)) {
      const match = line.match(
        /^\s*(?:export\s+)?(ARTIFACTBIN_URL|ARTIFACTBIN_TOKEN)\s*=\s*(.*?)\s*$/,
      );
      if (match) saved[match[1]] = match[2].replace(/^(['"])(.*)\1$/, "$2");
    }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
  if (!saved.ARTIFACTBIN_TOKEN) {
    try {
      const legacy = JSON.parse(
        await readFile(join(home, ".config/artifact-bin/config.json"), "utf8"),
      );
      saved = { ARTIFACTBIN_URL: legacy.url, ARTIFACTBIN_TOKEN: legacy.token };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
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
  return { server: selected, token };
}
export async function saveConnection(
  connection: Connection,
  home = homedir(),
): Promise<void> {
  const server = normalizeServer(connection.server);
  if (!/^[A-Za-z0-9_-]+$/.test(connection.token))
    throw new Error("Invalid token format");
  const path = join(home, ".artifactbin.env");
  const temp = `${path}.${randomUUID()}.tmp`;
  await writeFile(
    temp,
    `ARTIFACTBIN_URL=${server}\nARTIFACTBIN_TOKEN=${connection.token}\n`,
    { mode: 0o600, flag: "wx" },
  );
  await rename(temp, path);
  await chmod(path, 0o600);
}
export function parseArgs(argv: string[]): {
  command: string;
  server?: string;
  name?: string;
  harness?: string;
  args: string[];
} {
  const [command = "help", ...args] = argv;
  const result: {
    command: string;
    server?: string;
    name?: string;
    harness?: string;
    args: string[];
  } = { command, args: [] };
  let i = 0;
  while (i < args.length && args[i].startsWith("--")) {
    const flag = args[i++];
    if (flag === "--") break;
    if (flag !== "--server" && flag !== "--name")
      throw new Error(
        `Unknown afbin option: ${flag}. Put harness flags after the harness name.`,
      );
    const value = args[i++];
    if (!value) throw new Error(`Missing value for ${flag}`);
    if (flag === "--server") result.server = normalizeServer(value);
    else result.name = value;
  }
  if (command === "remote") {
    result.harness = args[i++];
    if (!result.harness)
      throw new Error(
        "Usage: afbin remote [--server URL] [--name NAME] claude [--chrome]",
      );
    result.args = args.slice(i);
  } else if (i < args.length) throw new Error("Unexpected arguments");
  return result;
}
