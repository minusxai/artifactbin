import {test,describe} from "node:test";
import assert from "node:assert/strict";
import {runCli} from "../src/dispatch";
import { mkdtemp, writeFile, readFile, mkdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { delimiter, join } from "node:path";
import { installedHarnesses, parseLaunchFlags } from "../src/launcher";
import { parseCommand } from "../src/commands";
import {cliHarness} from './harness';

test("discovers executable harness files on PATH, without running them or listing directories", async () => {
  const dir = await mkdtemp(join(tmpdir(), "afbin-picker-"));
  try {
    await writeFile(join(dir, "codex"), "#!/bin/sh\nexit 99\n", { mode: 0o700 });
    await writeFile(join(dir, "claude"), "not executable", { mode: 0o600 });
    await mkdir(join(dir, "pi"));
    assert.deepEqual(await installedHarnesses([dir, dir].join(delimiter)), [{ command: "codex", label: "Codex" }]);
    assert.deepEqual(await installedHarnesses(join(dir, "missing")), []);
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test("optional flags preserve quoted arguments and never evaluate shell syntax", () => {
  assert.deepEqual(parseLaunchFlags(""), []);
  assert.deepEqual(parseLaunchFlags(`--model "a b" --resume 'c d' '' escaped\\ space`), ["--model", "a b", "--resume", "c d", "", "escaped space"]);
  assert.deepEqual(parseLaunchFlags('--value "$(touch /tmp/should-not-exist)" "$TOKEN"'), ["--value", "$(touch /tmp/should-not-exist)", "$TOKEN"]);
  assert.throws(() => parseLaunchFlags('"unfinished'), /Close the quote/);
  assert.throws(() => parseLaunchFlags("trailing\\"), /trailing backslash/);
});

test("remote preserves command flags and bare startup selects help", () => {
 assert.equal(parseCommand([]).command,'help');
 assert.deepEqual(parseCommand(['remote','codex','--yolo','--model','a b']),{command:'remote',positionals:['codex','--yolo','--model','a b'],flags:{}});
});

for (const entry of [["remote"], ["remote", "codex", "--yolo"]]) test(`real terminal launches from ${["afbin", ...entry].join(" ")}`, async () => {
  const { createServer } = await import("node:http");
  const { pty } = await import("../src/pty");
  const { fileURLToPath } = await import("node:url");
  const dir = await mkdtemp(join(tmpdir(), "afbin-launch-"));
  await writeFile(join(dir, "claude"), '#!/bin/sh\nprintf "WRONG-HARNESS\\n"\n', { mode: 0o700 });
  await writeFile(join(dir, "codex"), '#!/bin/sh\nprintf "CHOSEN-CODEX\\n"\nfor arg do printf "ARG=<%s>\\n" "$arg"; done\n', { mode: 0o700 });
  let relayed = "";
  const server = createServer(async (req, res) => {
    let raw = "";
    for await (const chunk of req) raw += chunk;
    res.setHeader("Content-Type", "application/json");
    if (req.method === "GET") return res.end(JSON.stringify({ sessions: [] }));
    if (req.url === "/api/remote/sessions") return res.end(JSON.stringify({ id: "launch", runnerKey: "key" }));
    relayed += JSON.parse(raw).output ?? "";
    res.end(JSON.stringify({ controller: "local", inputs: [] }));
  });
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  const port = (server.address() as { port: number }).port;
  const child = pty.spawn(process.execPath, ["--import", "tsx", fileURLToPath(new URL("../src/main.ts", import.meta.url)), ...entry], {
    cwd: process.cwd(), cols: 100, rows: 30,
    // Isolate HOME and every skill-target root: eager init installs the detected codex skill, which must
    // land inside the temp dir, never the real home.
    env: { ...process.env, PATH: dir, HOME: dir, ARTIFACTBIN_HOME: join(dir, ".artifactbin"),
      CLAUDE_CONFIG_DIR: join(dir, ".claude"), CODEX_HOME: join(dir, ".codex"),
      PI_CODING_AGENT_DIR: join(dir, ".pi", "agent"), XDG_CONFIG_HOME: join(dir, ".config"),
      ARTIFACTBIN_TOKEN: "test", ARTIFACTBIN_URL: `http://127.0.0.1:${port}` },
  });
  let output = "", selected = false, flags = false;
  child.onData(data => {
    output += data;
    if (!selected && output.includes("Choose an installed agent")) { selected = true; child.write("\x1b[B\r"); }
    if (!flags && output.includes("Optional flags for Codex")) { flags = true; child.write('--yolo --model "a b"\r'); }
  });
  const timeout = setTimeout(() => child.kill(), 10000);
  try {
    const exit = await new Promise<{ exitCode: number }>(resolve => child.onExit(resolve));
    assert.equal(exit.exitCode, 0, output);
    assert.match(relayed, /CHOSEN-CODEX/, output);
    assert.match(relayed, /ARG=<--yolo>/);
    assert.doesNotMatch(relayed, /WRONG-HARNESS/);
    if (entry.length > 1) assert.equal(selected, false, "manual invocation bypasses picker");
    else { assert.ok(selected && flags); assert.match(relayed, /ARG=<a b>/); }
  } finally {
    clearTimeout(timeout);
    server.closeAllConnections();
    await new Promise<void>(resolve => server.close(() => resolve()));
    await rm(dir, { recursive: true, force: true });
  }
});

describe('attaching to a remote session', () => {
  const harness=(prefix:string)=>cliHarness(prefix,{flags:['--json','--server','https://example.com']});

  test('remote --session attaches to an existing session as a controller and never creates a replacement',async()=>{
   const h=await harness('afbin-seed-remote-attach-');
   try{
    let created=0;
    const code=await runCli(['remote','--session','rs_1','--no-browser','--server','https://example.com'],{cwd:h.root,home:h.root,env:{},interactive:false,stdout:s=>h.out.push(s),stderr:()=>{},fetch:async(input,init)=>{const request=new Request(input,init);const path=new URL(request.url).pathname;if(request.method==='POST'&&path==='/api/remote/sessions')created++;if(path==='/api/remote/sessions/rs_1')return Response.json({session:{id:'rs_1',name:'pi',harness:'pi',cwd:'/w',machine:'m',cols:80,rows:24,online:false,exitCode:0,controller:'local',createdAt:'2026-09-11T00:00:00Z'},generation:'g1',seq:0,frames:[],snapshot:''});return Response.json({error:'not_found'},{status:404});}});
    assert.equal(code,0,h.out.join(''));assert.equal(created,0);
   }finally{await h.cleanup();}
  });
});

describe('remote sessions as a collection', () => {
  const harness=(prefix:string)=>cliHarness(prefix,{flags:['--json','--server','https://example.com'],account:null});
   const account=(response:Response)=>{response.headers.set('X-Artifactbin-Account','usr_seed');return response;};

  test('sessions list as a collection, pull as read-only YAML and terminate through delete',async()=>{
   const h=await harness('afbin-seed-sessions-');
   try{
    const session={id:'rs_1',name:'pi',harness:'pi',machine:'laptop',cwd:'/work',status:'online',cols:120,rows:40,controller:'local',created_at:'2026-09-11T00:00:00Z'};
    assert.equal(await h.invoke(['list','--type','session'],()=>account(Response.json({sessions:[session]}))),0,h.out.join(''));
    assert.equal(h.last().sessions[0].id,'rs_1');
    assert.equal(await h.invoke(['pull','--type','session','rs_1','--output','pi.yaml'],({path})=>account(Response.json(path==='/api/remote/sessions'?{sessions:[session]}:{session,generation:1,seq:0,frames:[],snapshot:''}))),0,h.out.join(''));
    const yaml=await readFile(join(h.root,'pi.yaml'),'utf8');assert.match(yaml,/type: session/);assert.match(yaml,/id: rs_1/);
    await writeFile(join(h.root,'pi.yaml'),yaml.replace('name: pi','name: renamed'));
    assert.notEqual(await h.invoke(['push','pi.yaml'],()=>{throw new Error('session YAML is read-only; no request may be sent');}),0);
    assert.equal(h.last().error.code,'readonly_resource');
    let deletes=0;
    assert.equal(await h.invoke(['delete','--type','session','rs_1'],({method})=>{if(method==='DELETE')deletes++;return account(Response.json(method==='DELETE'?{ok:true}:{session}));}),0,h.out.join(''));
    assert.equal(deletes,1);assert.equal(h.last().operations[0].status,'terminated');
   }finally{await h.cleanup();}
  });
});
