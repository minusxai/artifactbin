import { createInterface } from "node:readline/promises";
import { Writable } from "node:stream";
import {
  loadConnection,
  saveConnection,
  parseArgs,
  normalizeServer,
} from "./config";
import { api, ApiError } from "./client";
import { runRemote } from "./runner";
const help = `afbin — your local agent terminal, available in your browser

  afbin auth [--server https://artifactbin.dev]
  afbin remote [--server URL] [--name NAME] <command> [command flags...]

Examples:
  afbin remote claude --chrome
  afbin remote --name "Backend" codex
  afbin remote --server http://localhost:6400 pi

Auth reuses ~/.artifactbin.env, shared with artifactbin skills.
Open /chat on your server to see your sessions. Local typing takes control.
`;
async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (["help", "--help", "-h"].includes(args.command)) {
    process.stdout.write(help);
    return;
  }
  if (args.command === "auth") {
    if (!process.stdin.isTTY)
      throw new Error(
        "Run afbin auth in an interactive terminal to paste your token.",
      );
    const saved = await loadConnection(args.server);
    const server = normalizeServer(
      args.server ??
        saved?.server ??
        process.env.ARTIFACTBIN_URL ??
        "https://artifactbin.dev",
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
    } finally {
      rl.close();
    }
    return;
  }
  if (args.command !== "remote") throw new Error(help);
  const connection = await loadConnection(args.server);
  if (!connection)
    throw new Error(
      `No token saved for this server. Run afbin auth${args.server ? ` --server ${args.server}` : ""}.`,
    );
  await api(connection, "");
  process.exitCode = await runRemote({
    connection,
    command: args.harness!,
    args: args.args,
    name: args.name,
    onSession: (url) => process.stderr.write(`Remote session: ${url}\r\n`),
  });
}
main().catch((error) => {
  process.stderr.write(
    `${error instanceof ApiError && error.status === 401 ? "Token expired or invalid. Run afbin auth." : error instanceof Error ? error.message : "afbin failed"}\n`,
  );
  process.exitCode = 1;
});
