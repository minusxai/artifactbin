/**
 * secrets.mjs: the account's secrets, which its backend lambdas read as `env`
 * (contract: ./af-contracts.ts, server side src/server/secrets-contracts.ts).
 * A value comes in on standard input only and goes out to the server only.
 */
import { SECRET_NAME, SECRET_VALUE_MAX_BYTES, type SecretSummary } from "../server/secrets-contracts.ts";
import type { AfCommand, AfIo, SecretsJson } from "./af-contracts.ts";
import { ExitError, ports } from "./command-io.ts";
import { connect, serverMessage, type Request, type Sent } from "./transport.ts";

const isSummary = (value: unknown): value is SecretSummary =>
  !!value && typeof value === "object" && typeof (value as SecretSummary).name === "string" && typeof (value as SecretSummary).updatedAt === "string";

export async function secrets(command: Extract<AfCommand, { kind: "secrets" }>, io: AfIo): Promise<number> {
  const { action } = command;
  // Read the value before touching the server, so a usage error costs no request.
  let value: string | undefined;
  if (action.kind === "set") {
    if (!io.stdin) throw new ExitError(2, "secrets set reads the value from standard input, which is not available here.");
    value = (await io.stdin()).replace(/\n$/, "");
    if (!value) throw new ExitError(2, `Give the value on standard input, for example: printf '%s' "$VALUE" | node scripts/secrets.mjs set ${action.name}`);
    if (new TextEncoder().encode(value).length > SECRET_VALUE_MAX_BYTES)
      throw new ExitError(2, `A secret value is at most ${SECRET_VALUE_MAX_BYTES} bytes.`);
  }
  const io_ = ports(io);
  const server = await connect(io.env, io_, "manage account secrets");
  const request: Request =
    action.kind === "list"
      ? { method: "GET", path: "/api/secrets" }
      : action.kind === "set"
        ? { method: "PUT", path: `/api/secrets/${action.name}`, body: { value } }
        : { method: "DELETE", path: `/api/secrets/${action.name}` };
  const url = server.origin + request.path;
  const sent = await server.send(request);
  if (sent.kind === "unknown") throw new ExitError(3, `Could not reach ${url} after 3 tries: ${sent.error}`);
  if (sent.kind === "unavailable") throw new ExitError(3, `${url} answered ${sent.status} (${serverMessage(sent)}) 3 times; try again later.`);
  if (sent.status === 401) throw new ExitError(2, server.refused);
  if (sent.status < 200 || sent.status > 299) throw new ExitError(1, `${url} answered ${sent.status}: ${serverMessage(sent)}`);
  const output = describe(action, sent);
  io.stdout(command.json ? JSON.stringify(output.json, null, 2) + "\n" : output.text);
  return 0;
}

function describe(action: Extract<AfCommand, { kind: "secrets" }>["action"], sent: Extract<Sent, { kind: "response" }>): { json: SecretsJson; text: string } {
  if (action.kind === "list") {
    const listed = Array.isArray(sent.body.secrets) ? sent.body.secrets.filter(isSummary) : [];
    const width = Math.max(0, ...listed.map((secret) => secret.name.length));
    return {
      json: { secrets: listed },
      text: listed.length ? listed.map((secret) => `${secret.name.padEnd(width)}  set ${secret.updatedAt}\n`).join("") : "This account has no secrets.\n",
    };
  }
  if (action.kind === "set") {
    const secret = isSummary(sent.body) ? sent.body : { name: action.name, updatedAt: "" };
    return { json: { secret }, text: `Set ${secret.name}${secret.updatedAt ? ` (${secret.updatedAt})` : ""}. Lambdas you own read it as env.${secret.name}.\n` };
  }
  return { json: { name: action.name, deleted: true }, text: `Removed ${action.name}.\n` };
}

/** `set <NAME>` and `remove <NAME>` take one name matching SECRET_NAME. */
export function secretName(name: string | undefined): string | null {
  return name !== undefined && SECRET_NAME.test(name) ? name : null;
}
