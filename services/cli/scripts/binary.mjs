import {duckdbNative} from './duckdb-native.mjs';
// Node SEA plus node-pty's platform-native files, built on the target OS/architecture.
import { createHash } from "node:crypto";
import { tmpdir } from "node:os";
import { build } from "esbuild";
import { createRequire } from "node:module";
import {
  readFile,
  writeFile,
  mkdir,
  readdir,
  copyFile,
  chmod,
} from "node:fs/promises";
import { basename, dirname, join, resolve } from "node:path";
import { execFileSync } from "node:child_process";
import { gzipSync } from "node:zlib";
import { inject } from "postject";
const require = createRequire(import.meta.url);
const runtime = process.env.CLI__NODE ? resolve(process.env.CLI__NODE) : process.execPath;
const root = dirname(require.resolve("node-pty/package.json"));
execFileSync(process.execPath,["scripts/build.mjs"],{stdio:"inherit"});
await mkdir("dist", { recursive: true });
const files = {};
async function collect(relative) {
  const path = join(root, relative);
  let entries;
  try {
    entries = await readdir(path, { withFileTypes: true });
  } catch (e) {
    if (e.code === "ENOENT") return;
    throw e;
  }
  for (const entry of entries) {
    const file = join(relative, entry.name);
    if (entry.isDirectory()) await collect(file);
    else if (!file.endsWith(".map") && !file.endsWith(".pdb"))
      files[file] = (await readFile(join(root, file))).toString("base64");
  }
}
await collect("lib");
await collect(`prebuilds/${process.platform}-${process.arch}`);
await collect("build/Release");
files["package.json"] = (await readFile(join(root, "package.json"))).toString(
  "base64",
);
await writeFile("dist/pty.json.gz", gzipSync(JSON.stringify(files)));
const loader = `
import {getAsset} from 'node:sea';
import {mkdtempSync,mkdirSync,writeFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,dirname} from 'node:path';
import {gunzipSync} from 'node:zlib';
import {createRequire} from 'node:module';
const root=mkdtempSync(join(tmpdir(),'afbin-pty-'));
process.on('exit',()=>{try{rmSync(root,{recursive:true,force:true});}catch{}});
const files=JSON.parse(gunzipSync(Buffer.from(getAsset('pty'))).toString());
for(const [file,data] of Object.entries(files)) {
 const path=join(root,file);mkdirSync(dirname(path),{recursive:true,mode:0o700});
 writeFileSync(path,Buffer.from(data,'base64'),{mode: file.endsWith('spawn-helper')?0o700:0o600});
}
export const pty=createRequire(join(root,'package.json'))(root);
`;
const duckdb=await duckdbNative();
await build({
  entryPoints: ["src/main.ts"],
  outfile: "dist/sea.cjs",
  bundle: true,
  platform: "node",
  format: "cjs",
  target: "node22",
  plugins: [duckdb.plugin,
    {
      name: "native-asset",
      setup(b) {
        b.onLoad({ filter: /src\/pty\.ts$/ }, () => ({
          contents: loader,
          loader: "js",
        }));
      },
    },
  ],
});
await writeFile(
  "dist/sea-config.json",
  JSON.stringify({
    main: resolve("dist/sea.cjs"),
    output: resolve("dist/sea.blob"),
    disableExperimentalSEAWarning: true,
    useCodeCache: false,
    useSnapshot: false,
    assets: { pty: resolve("dist/pty.json.gz"), "sql-manifest":duckdb.asset },
  }),
);
execFileSync(
  runtime,
  ["--experimental-sea-config", "dist/sea-config.json"],
  { stdio: "inherit" },
);
const binary = resolve(
  `dist/afbin-${process.platform}-${process.arch}${process.platform === "win32" ? ".exe" : ""}`,
);
await copyFile(runtime, binary);
await chmod(binary, 0o755);
if (process.platform === "darwin")
  execFileSync("codesign", ["--remove-signature", binary]);
// Strip before injection: GNU strip rewrites ELF segments and can corrupt an injected SEA.
execFileSync("strip", process.platform === "darwin" ? ["-x",binary] : ["--strip-all",binary]);
await inject(binary, "NODE_SEA_BLOB", await readFile("dist/sea.blob"), {
  sentinelFuse: "NODE_SEA_FUSE_fce680ab2cc467b6e072b8b5df1996b2",
  ...(process.platform === "darwin" ? { machoSegmentName: "NODE_SEA" } : {}),
});
if (process.platform === "darwin")
  execFileSync("codesign", ["--sign", "-", binary]);
execFileSync(binary, ["--help"], { stdio: "inherit", cwd: tmpdir() });
const teaching=JSON.parse(await readFile("src/generated/teaching.json","utf8"));
const skills=Buffer.from(JSON.stringify({version:teaching.version,protocol:teaching.protocol,files:teaching.files})+'\n');
await writeFile("dist/afbin-skills.json",skills);
await copyFile("dist/share/man/man1/afbin.1","dist/afbin.1");
const sha256=data=>createHash('sha256').update(data).digest('hex');
const rawBytes=await readFile(binary),compressed=gzipSync(rawBytes,{level:9});
await writeFile(`${binary}.gz`,compressed);
await writeFile(`${binary}.manifest.json`,JSON.stringify({version:teaching.version,protocol:teaching.protocol,platform:process.platform,arch:process.arch,binary:{file:`afbin-${process.platform}-${process.arch}`,sha256:sha256(rawBytes),gzip:{file:`${basename(binary)}.gz`,sha256:sha256(compressed)}},skills:{file:'afbin-skills.json',sha256:sha256(skills)}},null,2)+'\n');
// The checksum list a release carries, so a local artifactbin can serve this build to its own installer.
const released=[basename(binary),`${basename(binary)}.manifest.json`,'afbin-skills.json','afbin.1',`${basename(binary)}.gz`,duckdb.file,basename(duckdb.asset)];
await writeFile('dist/SHA256SUMS',(await Promise.all(released.map(async file=>`${sha256(await readFile(join('dist',file)))}  ${file}`))).join('\n')+'\n');
console.log(`Built ${binary} with matching local skills, release manifest and SHA256SUMS.`);

await writeFile(`${binary}.sizes.json`,JSON.stringify({platform:process.platform,arch:process.arch,node:execFileSync(runtime,['--version'],{encoding:'utf8'}).trim(),smallIcu:execFileSync(runtime,['-p','String(process.config.variables.icu_small)'],{encoding:'utf8'}).trim(),coreInstalled:rawBytes.length,coreDownload:compressed.length,sqlInstalled:duckdb.manifest.files.reduce((sum,file)=>sum+file.size,0),sqlDownload:(await readFile(join('dist',duckdb.file))).length},null,2)+'\n');
