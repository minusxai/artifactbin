import { execFileSync } from "node:child_process";
import { createRequire } from "node:module";
import { build } from "esbuild";
import { cliBundle } from "./bundle-options.mjs";
import { chmod, mkdir, readFile, writeFile, rm } from "node:fs/promises";
execFileSync(process.execPath,["scripts/generate-teaching.mjs"],{stdio:"inherit"});
await rm('dist/skills/artifactbin',{recursive:true,force:true});
const teaching=JSON.parse(await readFile("src/generated/teaching.json","utf8"));
for(const [file,content] of Object.entries(teaching.files)){
 const target=`dist/skills/artifactbin/${file}`;
 await mkdir(target.slice(0,target.lastIndexOf('/')),{recursive:true});
 await writeFile(target,content);
}
await mkdir('dist/share/man/man1',{recursive:true});
await writeFile('dist/share/man/man1/afbin.1',teaching.man);

execFileSync(
  process.execPath,
  [
    createRequire(import.meta.url).resolve("typescript/bin/tsc"),
    "-p",
    "tsconfig.build.json",
  ],
  { stdio: "inherit" },
);

execFileSync(process.execPath,["scripts/build-host.mjs"],{stdio:"inherit"});

// The dev wrapper compares the entry timestamp with generated app inputs too.
// Emit it only after host generation succeeds, or every command rebuilds again.
await build({ ...cliBundle({ afbin: "src/main.ts", index: "src/index.ts" }), outdir: "dist" });
await chmod("dist/afbin.mjs", 0o755);
