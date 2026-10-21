/** The real ports behind publish.mjs, comments.mjs and auth.mjs (contract: ./lifecycle-contracts.ts). */
import { randomUUID } from "node:crypto";
import { chmod, mkdir, readFile, readdir, rename, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import type { AfFetch } from "./af-contracts.ts";
import type { FilePort, LifecyclePorts } from "./lifecycle-contracts.ts";

/** A request with no answer after this long counts as an unknown outcome. */
export const REQUEST_TIMEOUT_MS = 120_000;

const fetchWithTimeout: AfFetch = async (url, init) => {
  const timeout = AbortSignal.timeout(REQUEST_TIMEOUT_MS);
  const response = await fetch(url, { ...init, signal: init.signal ? AbortSignal.any([init.signal, timeout]) : timeout });
  // Read the body within the same deadline, so a dropped connection is an error here.
  const text = await response.text();
  return {
    status: response.status,
    json: async () => JSON.parse(text) as unknown,
  };
};

export const files: FilePort = {
  async read(path) {
    try {
      return await readFile(path, "utf8");
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
      throw error;
    }
  },
  async write(path, text, options) {
    const directory = dirname(path);
    await mkdir(directory, { recursive: true, ...(options?.private ? { mode: 0o700 } : {}) });
    // An existing directory keeps its mode on mkdir; tighten it. The temporary file is created 0600, and rename keeps that.
    if (options?.private) await chmod(directory, 0o700);
    const temporary = join(directory, `.${randomUUID()}.tmp`);
    await writeFile(temporary, text, options?.private ? { mode: 0o600 } : {});
    if (options?.private) await chmod(temporary, 0o600);
    await rename(temporary, path);
  },
  async remove(path) {
    await rm(path, { force: true });
  },
  async list(directory) {
    try {
      return await readdir(directory);
    } catch {
      return [];
    }
  },
};

export function realPorts(signal?: AbortSignal): LifecyclePorts {
  return {
    fetch: fetchWithTimeout,
    fs: files,
    now: () => Date.now(),
    random: () => randomUUID(),
    sleep: (ms, abort) =>
      new Promise<void>((resolve) => {
        if (abort?.aborted) return resolve();
        const timer = setTimeout(done, ms);
        function done() {
          clearTimeout(timer);
          abort?.removeEventListener("abort", done);
          resolve();
        }
        abort?.addEventListener("abort", done, { once: true });
      }),
    ...(signal ? { signal } : {}),
  };
}
