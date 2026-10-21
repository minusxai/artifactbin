import { mkdtempSync, readFileSync, writeFileSync, rmSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
const base = fileURLToPath(new URL(".", import.meta.url));
const source = readFileSync(base + "store.ts", "utf8");
const mutants = [
  ["rollback disabled", "if (mutation && !result.errors)", "if (mutation)"],
  ["freeze disabled", "if (!mutation) freeze(draft);", ""],
  ["committed draft aliased", "state = clone(draft);", "state = draft;"],
  [
    "reentrancy guard removed",
    'if (mutation && busy) return failure("Reentrant mutation");',
    "",
  ],
  ["budget disabled", "if (++fields > 512)", "if (++fields > 100000)"],
  ["watch variables aliased", "variables: clone(variables)", "variables"],
];
for (const [name, from, to] of mutants) {
  if (!source.includes(from)) throw Error("Stale mutant " + name);
  const dir = mkdtempSync(base + ".negative-");
  try {
    for (const file of ["contracts.ts", "store.test.ts"])
      writeFileSync(dir + "/" + file, readFileSync(base + file));
    writeFileSync(dir + "/store.ts", source.replace(from, to));
    const result = spawnSync(
      process.execPath,
      ["--import", "tsx", "--test", dir + "/store.test.ts"],
      { encoding: "utf8", timeout: 10000 },
    );
    if (result.status === 0) throw Error("SURVIVED " + name);
    if (result.error) throw result.error;
    console.log("Detected:", name);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}
