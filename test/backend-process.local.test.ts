import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, writeFile, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
const exec = promisify(execFile);
const fake = String.raw`#!/usr/bin/env node
const fs=require('node:fs');const path=require('node:path');
const dir=process.env.FIXTURE_DIR,mode=process.env.FIXTURE_MODE,args=process.argv.slice(2),marker=path.join(dir,'created');
// The sandbox network is looked up once per host; these tests follow containers.
if(args[0]!=='network')fs.appendFileSync(path.join(dir,'calls'),args[0]+'\n');
const gone=path.join(dir,'network-gone');
if(args[0]==='network'){
 if(args[1]==='inspect'){if(fs.existsSync(gone)){console.error('Error: No such network: pagegi-sandbox');process.exit(1)}console.log(JSON.stringify({Name:'pagegi-sandbox',Driver:'bridge',EnableIPv6:mode==='ipv6',Options:{'com.docker.network.bridge.enable_icc':'false','com.docker.network.bridge.name':'pagegi-sbx'}}))}
 else if(args[1]==='create'){fs.rmSync(gone,{force:true});fs.appendFileSync(path.join(dir,'calls'),'network-create\n')}
 process.exit(0);
}
if(args[0]==='image'){console.log('sha256:'+'a'.repeat(64))}
else if(args[0]==='create'&&mode==='pruned'&&!fs.existsSync(path.join(dir,'pruned'))){
 // Someone ran docker network prune: the daemon refuses the create and makes nothing.
 fs.writeFileSync(path.join(dir,'pruned'),'yes');fs.writeFileSync(gone,'yes');
 console.error('Error response from daemon: network pagegi-sandbox not found');process.exit(1);
}
else if(args[0]==='create'){
 fs.writeFileSync(path.join(dir,'creating'),'yes');
 // The marker holds the container's name, as the daemon would list it.
 const once=mode==='uncertain-once'&&!fs.existsSync(path.join(dir,'failed-once'));
 if(once)fs.writeFileSync(path.join(dir,'failed-once'),'yes');
 setTimeout(()=>{fs.writeFileSync(marker,args[3]);if(mode==='uncertain'||once)process.exit(1);console.log('container-id')},150);
}else if(args[0]==='start'){
 if(mode==='malformed'){process.stdout.write(Buffer.from([0x7b,0x22,0x78,0x22,0x3a,0x22,0xff,0x22,0x7d,10]));process.exit(0)}
 if(mode==='duplicate'){console.log(JSON.stringify({ok:true,value:'first'}));console.log(JSON.stringify({ok:true,value:'second'}));process.exit(0)}
 if(mode==='duplicate-capability'){const frame=JSON.stringify({kind:'capability',id:1,request:{kind:'invoke',resource:'r',operation:'read',input:null}});process.stdout.write(frame+'\n'+frame+'\n');process.stdin.resume();return;}
 if(mode==='forged'){console.log(JSON.stringify({kind:'capability',id:1,request:{kind:'invoke',resource:'r',operation:'read',input:null,tenant:'forged'}}));process.stdin.resume();return;}
 // A served sandbox: the first frame names the bundle, then each invoke frame gets a result frame, one byte at a time
 // ('slow': whole, after 300 ms; 'failing': a failure with a message, then a store_limit the host never served).
 let buf='',served=0;process.stdin.setEncoding('utf8');
 process.stdin.on('data',d=>{buf+=d;let i;while((i=buf.indexOf('\n'))>=0){const f=JSON.parse(buf.slice(0,i));buf=buf.slice(i+1);
  if(f.kind==='invoke'){fs.appendFileSync(path.join(dir,'calls'),'invoke\n');served++;
   const value=f.input&&f.input.args&&f.input.args.echo||'🌍';
   if(mode==='failing'){console.log(JSON.stringify({kind:'result',ok:false,code:'backend_rejected',message:'  boom at checkout\u0007 \nstack line 1\nstack line 2'}));continue;}
   if(mode==='slow'){setTimeout(()=>console.log(JSON.stringify({kind:'result',ok:true,value})),300);continue;}
   const b=Buffer.from(JSON.stringify({kind:'result',ok:true,value})+'\n');let j=0;
   const emit=()=>{if(j===b.length)return;process.stdout.write(b.subarray(j,j+1));j++;setTimeout(emit,2)};emit();}}});
 process.stdin.on('end',()=>process.exit(0));
}else if(args[0]==='rm'){
 const remove=()=>{if(fs.existsSync(path.join(dir,'stuck'))){console.log('busy')}else{fs.rmSync(marker,{force:true});console.log('removed')}};
 if(mode==='held-rm'){fs.writeFileSync(path.join(dir,'removing'),'yes');const timer=setInterval(()=>{if(!fs.existsSync(dir)){clearInterval(timer);return}if(fs.existsSync(path.join(dir,'release-removal'))){clearInterval(timer);remove()}},5)}else remove();
}
else if(args[0]==='inspect'){if(fs.existsSync(marker)){console.log('{}')}else{console.error('No such object');process.exit(1)}}
else if(args[0]==='ps'){if(fs.existsSync(marker))console.log(fs.readFileSync(marker,'utf8'))}
`;
async function fixture(mode: string, code: string) {
  const dir = await mkdtemp(join(tmpdir(), "backend-process-"));
  try {
    await writeFile(join(dir, "docker"), fake, { mode: 0o700 });
    const hostURL = new URL("../src/backend/container-host.ts", import.meta.url)
      .href;
    const deploymentURL = new URL(
      "../src/backend/deployment.ts",
      import.meta.url,
    ).href;
    await writeFile(
      join(dir, "probe.mjs"),
      `import assert from 'node:assert/strict';import {readFile,writeFile,rm} from 'node:fs/promises';import {createBackendHost} from ${JSON.stringify(hostURL)};import {sealDeployment,BACKEND_RUNTIME} from ${JSON.stringify(deploymentURL)};const scope={owner:"backend-owner",fileId:"backend-file"};${code}`,
    );
    await exec(process.execPath, [join(dir, "probe.mjs")], {
      env: {
        ...process.env,
        PATH: dir + ":" + process.env.PATH,
        FIXTURE_DIR: dir,
        FIXTURE_MODE: mode,
      },
      timeout: 10000,
    });
    await assert.rejects(readFile(join(dir, "created")), /ENOENT/);
    return await readFile(join(dir, "calls"), "utf8");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}
test("cancel during daemon create waits for acknowledgement, removes container, never starts it", async () => {
  const calls = await fixture(
    "cancel",
    `const host=createBackendHost();const abort=new AbortController();const pending=host.compile('source',abort.signal);while(true){try{await readFile(process.env.FIXTURE_DIR+'/creating');break}catch{await new Promise(r=>setTimeout(r,2))}}abort.abort();await assert.rejects(pending,/cancelled/);`,
  );
  assert.equal(calls, "image\ncreate\nrm\ninspect\n");
});
test("an unacknowledged create fails closed; the host proves the container gone before admitting the next call", async () => {
  const calls = await fixture(
    "uncertain",
    `const host=createBackendHost();await assert.rejects(host.compile('source'),/cleanup_failed/);await assert.rejects(host.compile('source'),/cleanup_failed/);await assert.rejects(host.close(),/cleanup_failed/);`,
  );
  // Each failure: the call's own cleanup, then the proof (remove, check absent, list ours); the second call was admitted.
  assert.equal(calls, "image\ncreate\nrm\ninspect\nrm\ninspect\nps\ncreate\nrm\ninspect\nrm\ninspect\nps\n");
});
const APP = `const app=sealDeployment('source','compiled',{typeDefs:'type Query{value:String}',fields:['value'],runtime:BACKEND_RUNTIME+'/image:sha256:'+'a'.repeat(64)});`;
test("stdout framing preserves Unicode split across every byte, and close removes the warm sandbox", async () => {
  const calls = await fixture(
    "unicode",
    `${APP}const host=createBackendHost();assert.equal(await host.invoke({ deployment: app, principal: {tenant:'t',subject:'u'}, input: {field:'value',args:null}, env: {}, reuse: { kind: "file", scope: scope } }),'🌍');await host.close();`,
  );
  assert.equal(calls, "image\ncreate\nstart\ninvoke\nrm\ninspect\n");
});
test("a sandbox network of the right name but other settings is refused, and no sandbox is attached to it", async () => {
  const calls = await fixture(
    "ipv6",
    `${APP}const lines=[];const host=createBackendHost({log:(l)=>lines.push(l)});await assert.rejects(host.invoke({ deployment: app, principal: {tenant:'t',subject:'u'}, input: {field:'value',args:null}, env: {}, reuse: { kind: "file", scope: scope } }),/backend_unavailable/);assert.match(lines.join(),/pagegi-sandbox is not an IPv4-only bridge/);await host.close();`,
  );
  assert.doesNotMatch(calls, /create/);
});
test("a sandbox network removed under the host is recreated once, and the call still runs", async () => {
  const calls = await fixture(
    "pruned",
    `${APP}const host=createBackendHost();assert.equal(await host.invoke({ deployment: app, principal: {tenant:'t',subject:'u'}, input: {field:'value',args:null}, env: {}, reuse: { kind: "file", scope: scope } }),'🌍');await host.close();`,
  );
  assert.equal(calls, "image\ncreate\nrm\ninspect\nnetwork-create\ncreate\nstart\ninvoke\nrm\ninspect\n");
});
test("a second call to the same backend version reuses its warm sandbox", async () => {
  const calls = await fixture(
    "unicode",
    `${APP}const host=createBackendHost();for(let i=0;i<3;i++)assert.equal(await host.invoke({ deployment: app, principal: {tenant:'t',subject:'u'}, input: {field:'value',args:null}, env: {}, reuse: { kind: "file", scope: scope } }),'🌍');await host.close();`,
  );
  assert.equal(calls, "image\ncreate\nstart\ninvoke\ninvoke\ninvoke\nrm\ninspect\n");
});
test("a sandbox idle for warmIdleMs is removed without a close, and the next call starts a new one", async () => {
  const calls = await fixture(
    "unicode",
    `${APP}const host=createBackendHost({warmIdleMs:40});await host.invoke({ deployment: app, principal: {tenant:'t',subject:'u'}, input: {field:'value',args:null}, env: {}, reuse: { kind: "file", scope: scope } });await new Promise(r=>setTimeout(r,400));await assert.rejects(readFile(process.env.FIXTURE_DIR+'/created'),/ENOENT/);await host.invoke({ deployment: app, principal: {tenant:'t',subject:'u'}, input: {field:'value',args:null}, env: {}, reuse: { kind: "file", scope: scope } });await host.close();`,
  );
  assert.equal(calls, "image\ncreate\nstart\ninvoke\nrm\ninspect\ncreate\nstart\ninvoke\nrm\ninspect\n");
});

for (const mode of [
  "malformed",
  "duplicate",
  "forged",
  "duplicate-capability",
]) {
  test(`untrusted ${mode} frames reject without invoking trusted handler`, async () => {
    await fixture(
      mode,
      `const app=sealDeployment('source','compiled',{typeDefs:'type Query{value:String}',fields:['value'],runtime:BACKEND_RUNTIME+'/image:sha256:'+'a'.repeat(64)});let calls=0;await assert.rejects(createBackendHost({capabilityHandler:async()=>{calls++;return null}}).invoke({ deployment: app, principal: {tenant:'t',subject:'u'}, input: {field:'value',args:null}, env: {}, reuse: { kind: "file", scope: scope } }),/backend_rejected/);assert.equal(calls,0);`,
    );
  });
}

test("a deployment of an older runtime generation no longer verifies, so it is recompiled before it runs", async () => {
  const { sealDeployment, BACKEND_RUNTIME } = await import(
    "../src/backend/deployment.ts"
  );
  for (const protocol of ["protocol@1", "protocol@2"])
    assert.throws(
      () =>
        sealDeployment("source", "compiled", {
          typeDefs: "type Query{value:String}",
          fields: ["value"],
          runtime: BACKEND_RUNTIME.replace("protocol@3", protocol),
        }),
      /schema_rejected/,
    );
});
test("host close stops admission, cancels creation and awaits verified cleanup", async () => {
  const calls = await fixture(
    "cancel",
    `const host=createBackendHost();const pending=host.compile('source');const rejection=assert.rejects(pending,/cancelled/);while(true){try{await readFile(process.env.FIXTURE_DIR+'/creating');break}catch{await new Promise(r=>setTimeout(r,2))}}const closing=host.close();assert.equal(host.close(),closing);await assert.rejects(host.compile('source'),/backend_unavailable/);await closing;await rejection;await assert.rejects(readFile(process.env.FIXTURE_DIR+'/created'),/ENOENT/);`,
  );
  assert.equal(calls, "image\ncreate\nrm\ninspect\n");
});
test("host close preserves ambiguous creation cleanup failure", async () => {
  await fixture(
    "uncertain",
    `const host=createBackendHost();const pending=host.compile('source');const rejection=assert.rejects(pending,/cleanup_failed/);while(true){try{await readFile(process.env.FIXTURE_DIR+'/creating');break}catch{await new Promise(r=>setTimeout(r,2))}}const closing=host.close();assert.equal(host.close(),closing);await assert.rejects(closing,/cleanup_failed/);await rejection;`,
  );
});

test("after an unclean cleanup the host recovers by itself once its container is proven gone", async () => {
  const calls = await fixture(
    "uncertain-once",
    `${APP}const lines=[];const host=createBackendHost({log:(line)=>lines.push(line)});await assert.rejects(host.invoke({ deployment: app, principal: {tenant:'t',subject:'u'}, input: {field:'value',args:null}, env: {}, reuse: { kind: "file", scope: scope } }),/cleanup_failed/);assert.equal(await host.invoke({ deployment: app, principal: {tenant:'t',subject:'u'}, input: {field:'value',args:null}, env: {}, reuse: { kind: "file", scope: scope } }),'🌍');await host.close();assert.equal(lines.length,2);assert.match(lines[0],/^backend host closed: container pagegi-backend-[0-9a-f-]{36} /);assert.match(lines[1],/^backend host reopened: /);`,
  );
  assert.equal(calls, "image\ncreate\nrm\ninspect\nrm\ninspect\nps\ncreate\nstart\ninvoke\nrm\ninspect\n");
});
test("while its container cannot be proven gone the host stays closed, retries after a pause, and reopens once it is", async () => {
  const calls = await fixture(
    "stuck",
    `${APP}const lines=[];const host=createBackendHost({warmIdleMs:40,recoveryRetryMs:300,log:(line)=>lines.push(line)});const dir=process.env.FIXTURE_DIR;const call=()=>host.invoke({ deployment: app, principal: {tenant:'t',subject:'u'}, input: {field:'value',args:null}, env: {}, reuse: { kind: "file", scope: scope } });await writeFile(dir+'/stuck','yes');assert.equal(await call(),'🌍');for(let i=0;i<500;i++){if((await readFile(dir+'/calls','utf8')).split('\\n').length>=9)break;await new Promise(r=>setTimeout(r,10))}assert.equal(lines.length,1,'closed after the idle removal failed');await assert.rejects(call(),/backend_unavailable/);await assert.rejects(call(),/backend_unavailable/);assert.equal(lines.length,1);await rm(dir+'/stuck');await new Promise(r=>setTimeout(r,350));assert.equal(await call(),'🌍');assert.equal(lines.length,2);await host.close();`,
  );
  // The idle sandbox's removal is not verified and the proof fails at once (the probe waits for those commands to
  // start); the next call fails on that proof; the call right after it fails fast within the pause; after the pause
  // the proof succeeds and the call runs.
  // The second call either joins the proof still in flight or runs its own; the third adds nothing.
  assert.match(calls, /^image\ncreate\nstart\ninvoke\nrm\ninspect\n(?:rm\ninspect\n){1,2}rm\ninspect\nps\ncreate\nstart\ninvoke\nrm\ninspect\n$/);
});
test("calls beyond maxConcurrent wait for a slot in arrival order instead of failing", async () => {
  const calls = await fixture(
    "slow",
    `${APP}const host=createBackendHost({maxConcurrent:1});const call=(echo)=>host.invoke({ deployment: app, principal: {tenant:'t',subject:'u'}, input: {field:'value',args:{echo}}, env: {}, reuse: { kind: "file", scope: scope } });assert.deepEqual(await Promise.all([call('a'),call('b'),call('c')]),['a','b','c']);await host.close();`,
  );
  assert.equal(calls, "image\ncreate\nstart\ninvoke\ninvoke\ninvoke\nrm\ninspect\n");
});
test("a call that waits longer than admitWaitMs is refused backend_busy, and the running call is unaffected", async () => {
  await fixture(
    "slow",
    `${APP}const host=createBackendHost({maxConcurrent:1,admitWaitMs:20});const first=host.invoke({ deployment: app, principal: {tenant:'t',subject:'u'}, input: {field:'value',args:{echo:'first'}}, env: {}, reuse: { kind: "file", scope: scope } });const started=Date.now();await assert.rejects(host.invoke({ deployment: app, principal: {tenant:'t',subject:'u'}, input: {field:'value',args:{echo:'second'}}, env: {}, reuse: { kind: "file", scope: scope } }),/backend_busy/);assert.ok(Date.now()-started<250,'refused before the running call finished');assert.equal(await first,'first');await host.close();`,
  );
});
test("a queued call cancelled while waiting leaves the queue; the next waiter takes its turn", async () => {
  const calls = await fixture(
    "slow",
    `${APP}const host=createBackendHost({maxConcurrent:1});const call=(echo,signal)=>host.invoke({ deployment: app, principal: {tenant:'t',subject:'u'}, input: {field:'value',args:{echo}}, signal: signal, env: {}, reuse: { kind: "file", scope: scope } });const first=call('first');const abort=new AbortController();const second=call('second',abort.signal);const third=call('third');abort.abort();await assert.rejects(second,/cancelled/);assert.deepEqual(await Promise.all([first,third]),['first','third']);await host.close();`,
  );
  assert.equal(calls, "image\ncreate\nstart\ninvoke\ninvoke\nrm\ninspect\n");
});
test("a failed call carries the sandbox's message as one bounded line", async () => {
  await fixture(
    "failing",
    `${APP}const host=createBackendHost();await assert.rejects(host.invoke({ deployment: app, principal: {tenant:'t',subject:'u'}, input: {field:'value',args:null}, env: {}, reuse: { kind: "file", scope: scope } }),(error)=>{assert.equal(error.code,'backend_rejected');assert.equal(error.detail,'boom at checkout');return true});await host.close();`,
  );
});

for (const failed of [false, true]) {
  test(`close awaits an already retiring idle sandbox${failed ? " and reports failed cleanup" : ""}`, async () => {
    await fixture("held-rm", `${APP}
const host=createBackendHost({warmIdleMs:5});
await host.invoke({ deployment: app, principal: {tenant:'t',subject:'u'}, input: {field:'value',args:null}, env: {}, reuse: { kind: "file", scope: scope } });
const dir=process.env.FIXTURE_DIR;
for(;;){try{await readFile(dir+'/removing');break}catch{await new Promise(r=>setTimeout(r,2))}}
let closed=false;const closing=host.close();const outcome=closing.then(()=>{closed=true},()=>{closed=true});
await new Promise(r=>setTimeout(r,25));assert.equal(closed,false,'close must wait for disposal already removed from warm pool');
${failed ? "await writeFile(dir+'/stuck','yes');" : ""}
await writeFile(dir+'/release-removal','yes');
${failed ? "await assert.rejects(closing,/cleanup_failed/);await rm(dir+'/stuck');await rm(dir+'/created');" : "await closing;"}
await outcome;
`);
  });
}
