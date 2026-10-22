import { createRequire } from "node:module";
import { readdir, realpath } from "node:fs/promises";
import { dirname, join } from "node:path";
/** Resolve exactly as the offline font adapter does. Package root symlinks are
 * normal workspace installation details; content beneath each root is hashed. */
export async function migrationFontPackageInputs(
  legacyRoot: string,
): Promise<readonly { name: string; directory: string }[]> {
  const resolve = createRequire(join(legacyRoot, "package.json"));
  const names = new Set<string>();
  for (const search of resolve.resolve.paths("@fontsource-variable/fixture") ??
    []) {
    let entries;
    try {
      entries = await readdir(join(search, "@fontsource-variable"), {
        withFileTypes: true,
      });
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") continue;
      throw error;
    }
    for (const entry of entries)
      if (
        (entry.isDirectory() || entry.isSymbolicLink()) &&
        /^[a-z0-9][a-z0-9-]*$/.test(entry.name)
      )
        names.add("@fontsource-variable/" + entry.name);
  }
  if (!names.size)
    throw Error("Pinned font packages are required for compiler provenance");
  return await Promise.all(
    [...names, "wawoff2"]
      .sort()
      .map(async (name) => ({
        name,
        directory: await realpath(
          dirname(resolve.resolve(name + "/package.json")),
        ),
      })),
  );
}
