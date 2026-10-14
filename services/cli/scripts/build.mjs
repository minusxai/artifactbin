import { execFileSync, spawn } from "node:child_process";
import { createRequire } from "node:module";
import { build } from "esbuild";
import { cliBundle } from "./bundle-options.mjs";
import { chmod, mkdir, readFile, writeFile, rm } from "node:fs/promises";
// Through the repository's content-verified cache (run as a process, as build-host runs the server bundler): the
// app's prebuild and the host's server bundles below then reuse this generation instead of compiling it again.
execFileSync(process.execPath,["../../scripts/lib/generate-teaching.mjs"],{stdio:"inherit"});
await rm('dist/skills/artifactbin',{recursive:true,force:true});
const teaching=JSON.parse(await readFile("src/generated/teaching.json","utf8"));
for(const [file,content] of Object.entries(teaching.files)){
 const target=`dist/skills/artifactbin/${file}`;
 await mkdir(target.slice(0,target.lastIndexOf('/')),{recursive:true});
 await writeFile(target,content);
}
await mkdir('dist/share/man/man1',{recursive:true});
await writeFile('dist/share/man/man1/afbin.1',teaching.man);

// The declarations (dist/types) read only the CLI, contracts and utils sources (tsc --listFilesOnly), none of
// which the host build writes, so they compile beside it instead of before it.
const declarations = new Promise((resolve, reject) => {
  const child = spawn(process.execPath, [createRequire(import.meta.url).resolve("typescript/bin/tsc"), "-p", "tsconfig.build.json"], { stdio: "inherit" });
  child.on("error", reject);
  child.on("exit", (code, signal) => code === 0 ? resolve() : reject(new Error(`tsc -p tsconfig.build.json exited with ${signal ?? code}`)));
});
try {
  execFileSync(process.execPath,["scripts/build-host.mjs"],{stdio:"inherit"});
} finally {
  // Never leave the declaration build running past a failed host build, nor its failure unreported.
  await declarations.catch(() => {});
}
await declarations;

// Host generation updates app/lib inputs watched by the dev CLI wrapper.
// Publish the entry last so a successful build stays current.
await build({ ...cliBundle({ afbin: "src/main.ts", index: "src/index.ts" }), outdir: "dist" });
await chmod("dist/afbin.mjs", 0o755);
