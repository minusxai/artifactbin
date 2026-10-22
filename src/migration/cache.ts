import { createHash, randomUUID } from "node:crypto";
import { mkdir, open, readFile, rename, lstat, unlink } from "node:fs/promises";
import { join } from "node:path";
import { createReadStream } from "node:fs";
import { readdir } from "node:fs/promises";
import type { Converter, ConversionOutput } from "./contracts.ts";
import type {
  CompilerIdentityInputs,
  CachedConverter,
  ConversionCacheOptions,
} from "./cache-contracts.ts";
const digest = (s: string) => createHash("sha256").update(s).digest("hex");
const canonical = (v: unknown): string =>
  Array.isArray(v)
    ? "[" + v.map(canonical).join(",") + "]"
    : v && typeof v === "object"
      ? "{" +
        Object.entries(v)
          .sort(([a], [b]) => a.localeCompare(b))
          .map(([k, x]) => JSON.stringify(k) + ":" + canonical(x))
          .join(",") +
        "}"
      : (JSON.stringify(v) ?? "null");
/** Conversion only: authorization, identities and ownership are always replanned from original rows. */
export function cachedMigrationConverter(
  convert: Converter,
  options: ConversionCacheOptions,
): CachedConverter {
  if (!options.compilerIdentity)
    throw new Error("Explicit compiler identity required");
  const stats = { hits: 0, misses: 0, invalid: 0 };
  const max = options.maxBytes ?? 36 * 1024 * 1024;
  return {
    stats,
    convert: async (input) => {
      await mkdir(options.directory, { recursive: true, mode: 0o700 });
      const directoryInfo = await lstat(options.directory);
      if (!directoryInfo.isDirectory() || directoryInfo.mode & 0o077)
        throw new Error("Conversion cache directory must be private");
      const key = digest(
        canonical({
          cacheVersion: 1,
          compiler: options.compilerIdentity,
          strategy: options.strategy,
          input,
        }),
      );
      const path = join(options.directory, key + ".json");
      try {
        const info = await lstat(path);
        if (!info.isFile() || info.size > max || info.mode & 0o077)
          throw new Error("Invalid private cache file");
        const record = JSON.parse(await readFile(path, "utf8"));
        if (
          record.key !== key ||
          record.digest !== digest(canonical(record.result))
        )
          throw new Error("Cache digest mismatch");
        const r = record.result as ConversionOutput;
        if (
          !["renderable", "functional", "manual-blocked"].includes(
            r.classification,
          ) ||
          !(r.html === null || typeof r.html === "string") ||
          !Array.isArray(r.issues) ||
          !r.identities ||
          typeof r.identities !== "object"
        )
          throw new Error("Invalid cached conversion");
        stats.hits++;
        return r;
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ENOENT") stats.invalid++;
      }
      stats.misses++;
      const result = await convert(input);
      const text = JSON.stringify({
        key,
        digest: digest(canonical(result)),
        result,
      });
      if (Buffer.byteLength(text) > max)
        throw new Error("Conversion cache output exceeds bound");
      const temporary = path + "." + randomUUID() + ".partial";
      const file = await open(temporary, "wx", 0o600);
      try {
        await file.writeFile(text);
        await file.sync();
      } finally {
        await file.close();
      }
      try {
        await rename(temporary, path);
      } finally {
        await unlink(temporary).catch(() => {});
      }
      return result;
    },
  };
}
/** Include both adapter code and archived build manifest; path alone is not compiler provenance. */
export async function archivedCompilerIdentity(
  legacyRoot: string,
  inputs: CompilerIdentityInputs = {
    migrationRoot: new URL("../../", import.meta.url).pathname,
  },
): Promise<string> {
  const hash = createHash("sha256");
  async function tree(directory: string): Promise<void> {
    for (const item of (await readdir(directory, { withFileTypes: true })).sort(
      (a, b) => a.name.localeCompare(b.name),
    )) {
      if (item.isSymbolicLink())
        throw new Error("Compiler provenance must not contain symlinks");
      hash.update(
        JSON.stringify([item.isDirectory() ? "directory" : "file", item.name]) +
          "\0",
      );
      if (item.isDirectory()) {
        await tree(join(directory, item.name));
        hash.update("end-directory\0");
      } else if (item.isFile()) {
        const fileHash = createHash("sha256");
        for await (const chunk of createReadStream(join(directory, item.name)))
          fileHash.update(chunk);
        hash.update(fileHash.digest("hex") + "\0");
      }
    }
  }
  // Hash all local source: conversion bundles import shared Apollo/runtime helpers too.
  hash.update("migration-source\0");
  await tree(join(inputs.migrationRoot, "src"));
  for (const name of ["package.json", "package-lock.json"]) {
    hash.update("migration-package:" + name + "\0");
    hash.update(await readFile(join(inputs.migrationRoot, name)));
  }
  if (legacyRoot) {
    // These are required generated inputs, not optional caches. Missing builds fail closed.
    for (const relative of [
      "services/app/lib",
      "services/app/public/islands",
      "services/app/public/fonts",
      "services/app/scripts",
    ]) {
      hash.update("legacy-tree:" + relative + "\0");
      await tree(join(legacyRoot, relative));
    }
    for (const name of [
      "package.json",
      "package-lock.json",
      "services/app/package.json",
    ]) {
      hash.update("legacy-package:" + name + "\0");
      hash.update(await readFile(join(legacyRoot, name)));
    }
  }
  return hash.digest("hex");
}
