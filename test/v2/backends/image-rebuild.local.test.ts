/**
 * A backend compiled under one executor image keeps running after the image is
 * rebuilt. A fake `docker` on PATH stands in for the daemon: the image ID the
 * deployment recorded no longer exists, and the configured tag now names
 * another image.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { repositoryPath } from "../support/load.ts";

const exec = promisify(execFile);
const OLD = "sha256:" + "a".repeat(64);
const NEW = "sha256:" + "b".repeat(64);

/** Answers `image inspect <tag>` with NEW and fails for any image ID, like a daemon after a rebuild. */
const fakeDocker = String.raw`#!/usr/bin/env node
const fs=require('node:fs');const path=require('node:path');
const dir=process.env.FIXTURE_DIR,args=process.argv.slice(2),marker=path.join(dir,'created');
fs.appendFileSync(path.join(dir,'calls'),JSON.stringify(args)+'\n');
if(args[0]==='network'){if(args[1]==='inspect')console.log(JSON.stringify({Driver:'bridge',EnableIPv6:false,Options:{'com.docker.network.bridge.enable_icc':'false','com.docker.network.bridge.name':'pagegi-sbx'}}));process.exit(0)}
if(args[0]==='image'){const ref=args[args.length-1];if(ref.startsWith('sha256:')){console.error('Error: No such image: '+ref);process.exit(1)}console.log(process.env.FIXTURE_IMAGE)}
else if(args[0]==='create'){fs.writeFileSync(marker,'yes');console.log('container-id')}
else if(args[0]==='start'){let buf='';process.stdin.setEncoding('utf8');process.stdin.on('data',d=>{buf+=d;let i;while((i=buf.indexOf('\n'))>=0){const f=JSON.parse(buf.slice(0,i));buf=buf.slice(i+1);if(f.kind==='invoke')console.log(JSON.stringify({kind:'result',ok:true,value:'ran'}))}});process.stdin.on('end',()=>process.exit(0))}
else if(args[0]==='rm'){fs.rmSync(marker,{force:true})}
else if(args[0]==='inspect'){if(fs.existsSync(marker)){console.log('{}')}else{console.error('No such object');process.exit(1)}}
`;

async function withFakeDocker(code: string) {
  const dir = await mkdtemp(join(tmpdir(), "backend-rebuild-"));
  try {
    await writeFile(join(dir, "docker"), fakeDocker, { mode: 0o700 });
    const host = repositoryPath("src/backend/container-host.ts");
    const deployment = repositoryPath("src/backend/deployment.ts");
    await writeFile(
      join(dir, "probe.mjs"),
      `import assert from 'node:assert/strict';
import { createBackendHost } from ${JSON.stringify(host)};
import { sealDeployment, BACKEND_RUNTIME } from ${JSON.stringify(deployment)};
${code}`,
    );
    const { stderr } = await exec(process.execPath, [join(dir, "probe.mjs")], {
      env: {
        ...process.env,
        PATH: dir + ":" + process.env.PATH,
        FIXTURE_DIR: dir,
        FIXTURE_IMAGE: NEW,
        NODE_DEBUG: "pagegi",
      },
      timeout: 10000,
    });
    const calls = (await readFile(join(dir, "calls"), "utf8"))
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line) as string[]);
    return { calls, stderr };
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

test("a deployment recorded under a rebuilt image runs on the image the host is configured with", async () => {
  const { calls, stderr } = await withFakeDocker(`
const app = sealDeployment('source', 'compiled', {
  typeDefs: 'type Query { value: String }',
  fields: ['value'],
  runtime: BACKEND_RUNTIME + '/image:${OLD}',
});
const host = createBackendHost();
const value = await host.invoke({ deployment: app, principal: { tenant: 't', subject: 'u' }, input: { field: 'value', args: null }, env: {}, reuse: { kind: "one-shot" } });
assert.equal(value, 'ran');
await host.close();
`);
  const inspected = calls.find((args) => args[0] === "image")!;
  assert.equal(inspected.at(-1), "pagegi-backend:local", "the host looks up its configured tag, not the recorded ID");
  const created = calls.find((args) => args[0] === "create")!;
  assert.equal(created.at(-1), NEW, "the container runs the tag's current image");
  assert.match(stderr, /rebuilt/, "the differing recorded image is logged at debug level");
  assert.ok(!stderr.includes("source"), "the debug line never carries source");
});

test("an invoke on the image the deployment recorded logs nothing", async () => {
  const { calls, stderr } = await withFakeDocker(`
const app = sealDeployment('source', 'compiled', {
  typeDefs: 'type Query { value: String }',
  fields: ['value'],
  runtime: BACKEND_RUNTIME + '/image:${NEW}',
});
const host = createBackendHost();
assert.equal(await host.invoke({ deployment: app, principal: { tenant: 't', subject: 'u' }, input: { field: 'value', args: null }, env: {}, reuse: { kind: "one-shot" } }), 'ran');
await host.close();
`);
  assert.equal(calls.find((args) => args[0] === "create")!.at(-1), NEW);
  assert.doesNotMatch(stderr, /rebuilt/);
});
