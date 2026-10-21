/**
 * Load a phase-1 implementation module by its repository path, typed by its
 * frozen contract. The path is a runtime value, so `tsc` does not need the
 * module to exist yet; until it does, the test fails with ERR_MODULE_NOT_FOUND.
 */
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

export const repositoryRoot = resolve(import.meta.dirname, "../../..");

export function repositoryPath(relative: string): string {
  return resolve(repositoryRoot, relative);
}

export async function load<T>(relative: string): Promise<T> {
  return (await import(pathToFileURL(repositoryPath(relative)).href)) as T;
}
