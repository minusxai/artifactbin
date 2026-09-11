import { execFileSync } from "node:child_process";
import { createRequire } from "node:module";
import { build } from "esbuild";
import { chmod, mkdir, readFile, writeFile, rm } from "node:fs/promises";
execFileSync(process.execPath,["scripts/generate-teaching.mjs"],{stdio:"inherit"});
await build({
  entryPoints: { afbin: "src/main.ts", index: "src/index.ts" },
  outdir: "dist",
  outExtension: { ".js": ".mjs" },
  bundle: true,
  platform: "node",
  format: "esm",
  target: "node22",
  external: ["node-pty", "@duckdb/node-api"],
  banner: { js: "#!/usr/bin/env node\nimport {createRequire as __afbinCreateRequire} from 'node:module'; const require=__afbinCreateRequire(import.meta.url);" },
});
await chmod("dist/afbin.mjs", 0o755);
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
