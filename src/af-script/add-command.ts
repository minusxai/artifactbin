/** add.mjs: reserve one file ID per path over the shared transport, and record them in .af/ids.json. */
import { basename, dirname, join, relative, resolve } from "node:path";
import { FILE_ID_PATTERN } from "../af-contracts.ts";
import type { AddJson, AfCommand, AfIo } from "./af-contracts.ts";
import { ExitError, ports } from "./command-io.ts";
import { connect, serverMessage } from "./transport.ts";

export async function add(command: Extract<AfCommand, { kind: "add" }>, io: AfIo): Promise<number> {
  const io_ = ports(io);
  // Every path must exist before anything is reserved: an ID for a file that is not there is only confusing later.
  for (const path of command.paths) {
    const full = resolve(io.cwd, path);
    if (!(await io_.fs.list(dirname(full))).includes(basename(full))) throw new ExitError(2, `Cannot read ${path}: no such file.`);
  }
  // The record beside the page (the working directory), so publish.mjs finds each backend's file by its ID.
  const record = join(io.cwd, ".af", "ids.json");
  let ids: Record<string, string> = {};
  try {
    ids = JSON.parse((await io_.fs.read(record)) ?? "{}") as Record<string, string>;
  } catch {
    throw new ExitError(1, `.af/ids.json is not valid JSON; fix or remove it.`);
  }
  // A path that already has an ID keeps it, and a path given twice gets one ID:
  // publishing under a second ID would make a second file.
  const idFor = (key: string) => Object.entries(ids).find(([, recorded]) => recorded === key)?.[0];
  const entries = command.paths.map((path) => ({ path, key: relative(io.cwd, resolve(io.cwd, path)) || path }));
  const fresh = [...new Set(entries.map(({ key }) => key).filter((key) => !idFor(key)))];
  for (const { path, key } of entries) if (idFor(key)) io.stderr(`Note: ${path} already has ID ${idFor(key)}; keeping it.\n`);
  if (fresh.length) {
    const server = await connect(io.env, io_, "reserve IDs");
    const url = `${server.origin}/api/ids`;
    const count = fresh.length;
    const sent = await server.send({ method: "POST", path: "/api/ids", headers: { "Idempotency-Key": io_.random() }, body: { count } });
    if (sent.kind === "unknown") throw new ExitError(3, `Could not reach ${url} after 3 tries: ${sent.error}`);
    if (sent.kind === "unavailable") throw new ExitError(3, `${url} answered ${sent.status} (${serverMessage(sent)}) 3 times; try again later.`);
    if (sent.status === 401) throw new ExitError(2, server.refused);
    if (sent.status < 200 || sent.status > 299)
      throw new ExitError(3, `${url} answered ${sent.status}${typeof sent.body.error === "string" ? `: ${sent.body.error}` : ""}`);
    const reserved = sent.body.ids;
    if (!Array.isArray(reserved) || reserved.length !== count || !reserved.every((id) => typeof id === "string" && FILE_ID_PATTERN.test(id)))
      throw new ExitError(3, `${url} did not return ${count} file IDs.`);
    fresh.forEach((key, index) => (ids[reserved[index] as string] = key));
    await io_.fs.write(record, JSON.stringify(ids, null, 2) + "\n");
  }
  const files = entries.map(({ path, key }) => ({ path, id: idFor(key)! }));
  if (command.json) {
    const output: AddJson = { files };
    io.stdout(JSON.stringify(output, null, 2) + "\n");
    return 0;
  }
  const width = Math.max(...files.map(({ path }) => path.length));
  for (const { path, id } of files) io.stdout(`${path.padEnd(width)}  ${id}\n`);
  return 0;
}
