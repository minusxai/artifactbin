/** What each entry script (add.ts, check.ts, …) runs; bundled into scripts/lib/af-lib.mjs. */
import type { AfScriptName } from "./af-contracts.ts";
import { run } from "./af.ts";

export async function main(script: AfScriptName, scriptUrl: string): Promise<void> {
  // Ctrl-C stops comments --watch between polls, after its cursor is saved; a second one exits at once.
  const stop = new AbortController();
  process.on("SIGINT", () => (stop.signal.aborted ? process.exit(130) : stop.abort()));
  const code = await run(script, process.argv.slice(2), {
    env: process.env,
    cwd: process.cwd(),
    stdout: (text) => process.stdout.write(text),
    stderr: (text) => process.stderr.write(text),
    scriptUrl,
    ports: { signal: stop.signal },
    // Only `secrets set` reads it, and only once asked: a terminal is never blocked for the others.
    stdin: async () => {
      process.stdin.setEncoding("utf8");
      let text = "";
      for await (const chunk of process.stdin) text += chunk;
      return text;
    },
  });
  // Exit once both streams have flushed, so idle HTTP keep-alive sockets never hold the process.
  process.stdout.write("", () => process.stderr.write("", () => process.exit(code)));
}
