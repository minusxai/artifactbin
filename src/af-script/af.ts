/**
 * The skill's scripts: argument parsing and dispatch to each command's owner
 * (contract: ./af-contracts.ts). scripts/build-skill-scripts.mjs bundles this
 * with the page model into scripts/lib/af-lib.mjs, which needs only Node.js 20.10+.
 */

import { DESIGN_SYSTEMS } from "../af-contracts.ts";
import { add } from "./add-command.ts";
import type { AfCommand, AfIo, AfScriptName, CommentsAction, PublishMode, SecretsAction } from "./af-contracts.ts";
import type { AuthAction } from "./auth-contracts.ts";
import { runAuth } from "./auth-model.ts";
import { check } from "./check-command.ts";
import { ExitError, ports } from "./command-io.ts";
import { runComments } from "./comments-model.ts";
import { Failure } from "./failure.ts";
import { HELP } from "./help.ts";
import { describe, publishPage } from "./publish-model.ts";
import { secretName, secrets } from "./secrets-command.ts";
import { shot } from "./shot-command.ts";

type Io = AfIo;

const FLAGS: Record<string, { value: boolean; scripts: readonly AfScriptName[] }> = {
  "--json": { value: false, scripts: ["add", "check", "publish", "comments", "auth", "secrets"] },
  "--email": { value: true, scripts: ["auth"] },
  "--code": { value: true, scripts: ["auth"] },
  "--test-token": { value: false, scripts: ["auth"] },
  "--logout": { value: false, scripts: ["auth"] },
  "--new": { value: false, scripts: ["publish"] },
  "--force": { value: false, scripts: ["publish"] },
  "--pull": { value: false, scripts: ["publish"] },
  "--delete": { value: false, scripts: ["publish"] },
  "--yes": { value: false, scripts: ["publish"] },
  "--context": { value: true, scripts: ["comments"] },
  "--reply": { value: true, scripts: ["comments"] },
  "--on": { value: true, scripts: ["comments"] },
  "--edit": { value: true, scripts: ["comments"] },
  "--resolve": { value: true, scripts: ["comments"] },
  "--reopen": { value: true, scripts: ["comments"] },
  "--watch": { value: false, scripts: ["comments"] },
  "--body": { value: true, scripts: ["comments"] },
  "--quote": { value: true, scripts: ["comments"] },
  "--write-ids": { value: false, scripts: ["check"] },
  "--width": { value: true, scripts: ["shot"] },
  "--dark": { value: false, scripts: ["shot"] },
  "--design-system": { value: true, scripts: ["shot"] },
  "--out": { value: true, scripts: ["shot"] },
  "--state": { value: true, scripts: ["shot"] },
};

export function parseArguments(command: AfScriptName, argv: readonly string[]): AfCommand {
  if (argv.includes("--help") || argv.includes("-h")) return { kind: "help" };
  const usage = (detail: string) =>
    Error(`Usage error: ${detail}\nRun node scripts/${command}.mjs --help for every flag.`);
  const rest = argv;
  const positional: string[] = [];
  const flags = new Map<string, string | true>();
  for (let index = 0; index < rest.length; index++) {
    const argument = rest[index]!;
    if (!argument.startsWith("--")) {
      positional.push(argument);
      continue;
    }
    const [name, inline] = argument.includes("=") ? [argument.slice(0, argument.indexOf("=")), argument.slice(argument.indexOf("=") + 1)] : [argument, undefined];
    const flag = FLAGS[name];
    if (!flag || !flag.scripts.includes(command)) throw usage(`unknown flag "${name}".`);
    if (flag.value) {
      const value = inline ?? rest[++index];
      if (value === undefined || value === "") throw usage(`${name} needs a value.`);
      flags.set(name, value);
    } else {
      if (inline !== undefined) throw usage(`${name} takes no value.`);
      flags.set(name, true);
    }
  }
  if (command === "add") {
    if (!positional.length) throw usage("give at least one file path.");
    return { kind: "add", paths: positional, json: flags.has("--json") };
  }
  if (command === "auth") {
    if (positional.length) throw usage(`auth takes no file; got "${positional[0]}".`);
    return { kind: "auth", action: authAction(flags, usage), json: flags.has("--json") };
  }
  if (command === "secrets") return { kind: "secrets", action: secretsAction(positional, usage), json: flags.has("--json") };
  if (command === "comments") {
    if (positional.length !== 1) throw usage("give exactly one page file or page ID.");
    return { kind: "comments", target: positional[0]!, action: commentsAction(flags, usage), json: flags.has("--json") };
  }
  if (positional.length !== 1) throw usage("give exactly one HTML file.");
  const file = positional[0]!;
  if (command === "publish") {
    const modes = (["--new", "--force", "--pull", "--delete"] as const).filter((flag) => flags.has(flag));
    if (modes.length > 1) throw usage(`use only one of ${modes.join(", ")}.`);
    const mode: PublishMode = modes.length ? (modes[0]!.slice(2) as PublishMode) : "publish";
    if (mode === "delete" && !flags.has("--yes")) throw usage("--delete removes the page for everyone. Add --yes to confirm.");
    if (mode !== "delete" && flags.has("--yes")) throw usage("--yes only goes with --delete.");
    return { kind: "publish", file, mode, json: flags.has("--json") };
  }
  if (command === "check") return { kind: "check", file, writeIds: flags.has("--write-ids"), json: flags.has("--json") };
  const widthText = flags.get("--width");
  const width = widthText === undefined ? 1280 : Number(widthText);
  if (!Number.isInteger(width) || width < 1 || width > 10000) throw usage("--width must be a whole number of pixels.");
  const designSystem = flags.get("--design-system");
  if (typeof designSystem === "string" && !(DESIGN_SYSTEMS as readonly string[]).includes(designSystem))
    throw usage(`--design-system must be one of ${DESIGN_SYSTEMS.join(", ")}.`);
  const out = flags.get("--out");
  return {
    kind: "shot",
    file,
    width,
    dark: flags.has("--dark"),
    designSystem: typeof designSystem === "string" ? designSystem : null,
    out: typeof out === "string" ? out : "shot.png",
    state: typeof flags.get("--state") === "string" ? (flags.get("--state") as string) : null,
  };
}

function authAction(flags: Map<string, string | true>, usage: (detail: string) => Error): AuthAction {
  const email = flags.get("--email") as string | undefined;
  const code = flags.get("--code") as string | undefined;
  if (flags.has("--logout")) {
    if (email !== undefined || code !== undefined || flags.has("--test-token")) throw usage("--logout goes alone (with --json).");
    return { kind: "logout" };
  }
  if (flags.has("--test-token")) {
    if (email === undefined) throw usage("--test-token needs --email <address>.");
    if (code !== undefined) throw usage("--test-token takes no --code.");
    return { kind: "test-token", email };
  }
  if (code !== undefined) {
    if (email === undefined) throw usage("--code needs --email <address>, the address the code was sent to.");
    return { kind: "verify", email, code };
  }
  return email === undefined ? { kind: "status" } : { kind: "request", email };
}

function secretsAction(positional: readonly string[], usage: (detail: string) => Error): SecretsAction {
  if (!positional.length) return { kind: "list" };
  const [verb, name, extra] = positional;
  if (verb !== "set" && verb !== "remove") throw usage(`"${verb}" is not a command; use set <NAME>, remove <NAME>, or no command to list.`);
  if (name === undefined) throw usage(`${verb} needs a secret name.`);
  if (extra !== undefined) throw usage(`${verb} takes one name; ${verb === "set" ? "give the value on standard input, never as an argument." : `got "${extra}" too.`}`);
  if (!secretName(name)) throw usage(`"${name}" is not a secret name: a capital letter, then up to 63 capitals, digits and underscores, like STRIPE_KEY.`);
  return { kind: verb, name };
}

function commentsAction(flags: Map<string, string | true>, usage: (detail: string) => Error): CommentsAction {
  const actions = ["--context", "--reply", "--on", "--edit", "--resolve", "--reopen", "--watch"].filter((flag) => flags.has(flag));
  if (actions.length > 1) throw usage(`use only one of ${actions.join(", ")}.`);
  const action = actions[0];
  const value = action ? flags.get(action) : undefined;
  const body = flags.get("--body");
  const needsBody = action === "--reply" || action === "--on" || action === "--edit";
  if (needsBody && typeof body !== "string") throw usage(`${action} needs --body <text>.`);
  if (!needsBody && body !== undefined) throw usage("--body goes with --reply, --on or --edit.");
  if (flags.has("--quote") && action !== "--on") throw usage("--quote goes with --on.");
  const text = body as string;
  const id = value as string;
  switch (action) {
    case "--context":
      return { kind: "context", commentId: id };
    case "--reply":
      return { kind: "reply", commentId: id, body: text };
    case "--on":
      return { kind: "comment", nodeId: id, body: text, quote: (flags.get("--quote") as string | undefined) ?? "" };
    case "--edit":
      return { kind: "edit", commentId: id, body: text };
    case "--resolve":
      return { kind: "resolve", commentId: id, resolved: true };
    case "--reopen":
      return { kind: "resolve", commentId: id, resolved: false };
    case "--watch":
      return { kind: "watch" };
    default:
      return { kind: "list" };
  }
}

export async function run(script: AfScriptName, argv: readonly string[], io: Io): Promise<number> {
  try {
    const command = parseArguments(script, argv);
    switch (command.kind) {
      case "help":
        io.stdout(HELP[script]);
        return 0;
      case "add":
        return await add(command, io);
      case "check":
        return await check(command, io);
      case "shot":
        return await shot(command, io);
      case "publish": {
        const outcome = await publishPage(command.file, command.mode, { env: io.env, cwd: io.cwd, ports: ports(io) });
        if (command.json) io.stdout(JSON.stringify(outcome.json, null, 2) + "\n");
        else {
          const text = describe(outcome);
          if (text.stdout) io.stdout(text.stdout);
          if (text.stderr) io.stderr(text.stderr);
        }
        return outcome.code;
      }
      case "auth":
        return await runAuth(command.action, command.json, { env: io.env, ports: ports(io), stdout: io.stdout, stderr: io.stderr });
      case "secrets":
        return await secrets(command, io);
      case "comments":
        return await runComments(command.target, command.action, command.json, {
          env: io.env,
          cwd: io.cwd,
          ports: ports(io),
          stdout: io.stdout,
          stderr: io.stderr,
        });
    }
  } catch (error) {
    if (error instanceof ExitError || error instanceof Failure) {
      io.stderr(error.message + "\n");
      return error.code;
    }
    if (error instanceof Error && error.message.startsWith("Usage")) {
      io.stderr(error.message + "\n");
      return 2;
    }
    io.stderr(`${script}.mjs failed: ${error instanceof Error ? error.message : String(error)}\n`);
    return 1;
  }
}
