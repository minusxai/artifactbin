import { access, stat } from "node:fs/promises";
import { constants } from "node:fs";
import { delimiter, join } from "node:path";
import { emitKeypressEvents, type Key } from "node:readline";
import { createInterface } from "node:readline/promises";

export const harnesses = [
  { command: "claude", label: "Claude Code" },
  { command: "codex", label: "Codex" },
  { command: "pi", label: "Pi" },
  { command: "opencode", label: "OpenCode" },
];

/** Discover executables on PATH without running them. */
export async function installedHarnesses(path = process.env.PATH ?? "") {
  const directories = path.split(delimiter);
  const found = await Promise.all(harnesses.map(async harness => {
    for (const directory of directories) {
      const file = join(directory || ".", harness.command);
      try {
        await access(file, constants.X_OK);
        if ((await stat(file)).isFile()) return harness;
      } catch { /* Try the next PATH directory. */ }
    }
    return null;
  }));
  return found.filter(harness => harness !== null);
}

/** Quotes group arguments; no shell expansion, substitution, or evaluation. */
export function parseLaunchFlags(value: string): string[] {
  const args: string[] = [];
  let word = "", quote = "", started = false;
  for (let i = 0; i < value.length; i++) {
    const char = value[i];
    if (char === "\\" && quote !== "'") {
      if (++i === value.length) throw new Error("Finish the escaped character or remove the trailing backslash.");
      word += value[i];
      started = true;
    } else if (quote) {
      if (char === quote) quote = "";
      else word += char;
    } else if (char === "'" || char === '"') {
      quote = char;
      started = true;
    } else if (/\s/.test(char)) {
      if (started) { args.push(word); word = ""; started = false; }
    } else { word += char; started = true; }
  }
  if (quote) throw new Error("Close the quote around your argument.");
  if (started) args.push(word);
  return args;
}

class LaunchCancelled extends Error {}

async function selectHarness(choices: typeof harnesses) {
  const input = process.stdin, output = process.stdout;
  const wasRaw = input.isRaw;
  let selected = 0;
  const draw = () => output.write(choices.map((choice, i) =>
    `  ${i === selected ? ">" : " "} ${choice.label} (${choice.command})`,
  ).join("\n") + "\n");
  emitKeypressEvents(input);
  input.setRawMode(true);
  input.resume();
  try {
    return await new Promise<typeof harnesses[number]>((resolve, reject) => {
      const cleanup = () => {
        input.off("keypress", keypress);
        input.off("end", end);
      };
      const end = () => { cleanup(); reject(new LaunchCancelled()); };
      const keypress = (_text: string, key: Key) => {
        if (key.name === "escape" || (key.ctrl && (key.name === "c" || key.name === "d"))) return end();
        if (key.name === "return" || key.name === "enter") { cleanup(); resolve(choices[selected]); return; }
        if (key.name !== "up" && key.name !== "down") return;
        selected = (selected + (key.name === "up" ? -1 : 1) + choices.length) % choices.length;
        output.write(`\x1b[${choices.length}A\r\x1b[J`);
        draw();
      };
      input.on("keypress", keypress);
      input.once("end", end);
      output.write("Choose an installed agent (↑/↓, Enter; Esc to cancel):\n");
      draw();
    });
  } finally {
    input.setRawMode(wasRaw ?? false);
    input.pause();
  }
}

export async function chooseLaunch() {
  if (!process.stdin.isTTY || !process.stdout.isTTY)
    throw new Error("Run afbin in an interactive terminal to choose an agent, or specify a command with afbin remote <command> [flags].");
  const choices = await installedHarnesses();
  if (!choices.length)
    throw new Error("No supported agents found on PATH. Install Claude Code, Codex, Pi, or OpenCode, or run afbin remote <command> [flags] with another executable.");
  const harness = await selectHarness(choices);
  const rl = createInterface({ input: process.stdin, output: process.stdout, terminal: true });
  const abort = new AbortController();
  rl.on("SIGINT", () => abort.abort());
  rl.on("close", () => abort.abort());
  try {
    for (;;) {
      const flags = await rl.question(`Optional flags for ${harness.label} (Enter for defaults): `, { signal: abort.signal });
      try { return { command: harness.command, args: parseLaunchFlags(flags) }; }
      catch (error) { process.stdout.write(`${(error as Error).message}\n`); }
    }
  } catch (error) {
    if (abort.signal.aborted) throw new LaunchCancelled();
    throw error;
  } finally { rl.close(); }
}
