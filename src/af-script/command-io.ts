/** What every script command shares: the exit-code error, the real ports with a test's overrides, and reading the page file. */
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import type { AfIo } from "./af-contracts.ts";
import type { LifecyclePorts } from "./lifecycle-contracts.ts";
import { realPorts } from "./ports.ts";

export class ExitError extends Error {
  readonly code: number;
  constructor(code: number, message: string) {
    super(message);
    this.code = code;
  }
}

/** The real ports, under a test's injected fetch and ports. */
export function ports(io: AfIo): LifecyclePorts {
  return { ...realPorts(io.ports?.signal), ...(io.fetch ? { fetch: io.fetch } : {}), ...io.ports };
}

export async function readPage(io: AfIo, file: string): Promise<string> {
  try {
    return await readFile(resolve(io.cwd, file), "utf8");
  } catch {
    throw new ExitError(2, `Cannot read ${file}: no such file.`);
  }
}
