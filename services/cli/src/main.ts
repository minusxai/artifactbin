import { chooseLaunch, LaunchCancelled } from "./launcher";
import { ensureConnection } from "./auth";
import { createInterface } from "node:readline/promises";
import { Writable } from "node:stream";
import {
  loadConnection,
  saveConnection,
  parseArgs,
} from "./config";
import { api, ApiError } from "./client";
import { runRemote } from "./runner";
const help = `afbin — your local agent terminal, available in your browser

  afbin [--server URL] [--name NAME]
  afbin remote [--server URL] [--name NAME] [<command> [command flags...]]

Sign in when needed, then choose an installed agent and optional flags.
Provide a command to skip the picker; its flags are passed through unchanged.

Examples:
  afbin remote claude --chrome
  afbin remote --name "Backend" codex
  afbin remote --server http://localhost:6400 pi

Auth reuses ~/.artifactbin.env, shared with artifactbin skills.
Open /chat on your server to see your sessions. Type from your local terminal or browser.
`;
async function authenticate(server: string) {
  if (!process.stdin.isTTY)
    throw new Error(
      "Run afbin in an interactive terminal to sign in.",
    );
  process.stdout.write(
    `Open ${server}/tokens/new in your signed-in browser.\nPairing token: paste the account token below (input is hidden).\n`,
  );
  let muted = false;
  const output = new Writable({
    write(chunk, _encoding, callback) {
      if (!muted) process.stdout.write(chunk);
      callback();
    },
  });
  const rl = createInterface({
    input: process.stdin,
    output,
    terminal: true,
  });
  try {
    process.stdout.write("Token: ");
    muted = true;
    const token = (await rl.question("")).trim();
    muted = false;
    process.stdout.write("\n");
    const connection = { server, token };
    await api(connection, "");
    await saveConnection(connection);
    process.stdout.write(
      `Authenticated with ${server}. Saved to ~/.artifactbin.env.\n`,
    );
    return connection;
  } finally {
    rl.close();
  }
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (["help", "--help", "-h"].includes(args.command)) {
    process.stdout.write(help);
    return;
  }
  if (args.command !== "remote") throw new Error(help);
  const saved = await loadConnection(args.server);
  const connection = await ensureConnection(saved, args.server, {
    authenticate,
    validate: (connection) => api(connection, ""),
    notify: (message) => process.stdout.write(`${message}\n`),
  });
  const launch = args.harness
    ? { command: args.harness, args: args.args }
    : await chooseLaunch();
  process.exitCode = await runRemote({
    connection,
    ...launch,
    name: args.name,
    onSession: (url) => process.stderr.write(`Remote session: ${url}\r\n`),
  });
}
main().catch((error) => {
  if (error instanceof LaunchCancelled) { process.stdout.write("Cancelled.\n"); return; }
  process.stderr.write(
    `${error instanceof ApiError && error.status === 401 ? "Token expired or invalid. Run afbin to sign in again." : error instanceof Error ? error.message : "afbin failed"}\n`,
  );
  process.exitCode = 1;
});
