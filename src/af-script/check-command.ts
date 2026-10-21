/** check.mjs: the page model's problems, and --write-ids, the platform's node ID assignment written back. */
import { writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import type { PageModelModule } from "../page/page-contracts.ts";
import * as pageModel from "../page/page-model.ts";
import type { AfCommand, AfIo, CheckJson } from "./af-contracts.ts";
import { readPage } from "./command-io.ts";

const model: PageModelModule = pageModel;

/** --write-ids: the platform's ID assignment, written back only when it changed something. */
async function writeIds(
  file: string,
  source: string,
  io: AfIo,
): Promise<{ source: string; assigned: boolean; ids: NonNullable<CheckJson["ids"]> }> {
  let result;
  try {
    result = model.assignNodeIds(source);
  } catch (error) {
    // Invalid metadata JSON: the check reports it with its line.
    if (error instanceof Error && error.name === "PageError") {
      io.stderr(`${file}: no IDs added. ${error.message}\n`);
      return { source, assigned: false, ids: { written: false, changes: [] } };
    }
    throw error;
  }
  const written = result.source !== source;
  if (written) await writeFile(resolve(io.cwd, file), result.source);
  return { source: result.source, assigned: true, ids: { written, changes: result.changes } };
}

export async function check(command: Extract<AfCommand, { kind: "check" }>, io: AfIo): Promise<number> {
  let source = await readPage(io, command.file);
  let ids: CheckJson["ids"];
  let assigned = false;
  if (command.writeIds) ({ source, assigned, ids } = await writeIds(command.file, source, io));
  const problems = model.checkPage(source);
  if (command.json) {
    const output: CheckJson = ids ? { file: command.file, problems, ids } : { file: command.file, problems };
    io.stdout(JSON.stringify(output, null, 2) + "\n");
  } else {
    if (ids) {
      for (const change of ids.changes) io.stdout(`${command.file}:${change.line}  added <${change.tag} data-af-id="${change.id}">\n`);
      const count = ids.changes.length;
      if (ids.written) io.stderr(`${command.file}: wrote ${count} new ID${count === 1 ? "" : "s"}.\n`);
      else if (assigned) io.stderr(`${command.file}: every element already has a data-af-id.\n`);
    }
    for (const problem of problems)
      io.stdout(`${command.file}:${problem.line}  ${problem.warning ? "warning " : ""}${problem.code}  ${problem.message}\n`);
    if (!problems.length) io.stdout(`${command.file}: no problems found.\n`);
  }
  // Warnings are reported but don't fail the check.
  return problems.some((problem) => !problem.warning) ? 1 : 0;
}
