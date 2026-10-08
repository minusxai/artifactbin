import { test } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { runRemote } from "../src/runner";
import { HttpClient } from "../src/http";
import {deliverRemoteInput} from "../src/remote-input";
test("real PTY delivers a remote line and relays output and exit, acknowledging each input once", async () => {
  let output = "",
    ack = 0;
  let exit: number | undefined;
  let exchanges = 0;
  let local = "";
  const server = createServer(async (req, res) => {
    assert.equal(req.headers.authorization, "Bearer test");
    let raw = "";
    for await (const chunk of req) raw += chunk;
    const body = raw ? JSON.parse(raw) : {};
    res.setHeader("Content-Type", "application/json");
    if (req.url === "/api/remote/sessions") {
      res.end(JSON.stringify({ id: "test", runnerKey: "runner" }));
      return;
    }
    exchanges++;
    output += body.output;
    ack = body.ack;
    exit = body.exitCode;
    res.end(
      JSON.stringify({
        controller: "local",
        inputs: ack
          ? ack===1&&output.includes("received:from-comment")
            ? [{id:2,kind:"input",source:"comment",data:"finish\r"}]
            : []
          : [
              {
                id: 1,
                kind: "input",
                source: "comment",
                data: "from-comment\r",
              },
            ],
      }),
    );
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  const address = server.address() as { port: number };
  try {
    const code = await runRemote({
      client: new HttpClient({ connection: { server: `http://127.0.0.1:${address.port}`, token: "test" } }),
      command: "/bin/sh",
      // Keep the PTY open until the relay observes output; immediate shell exit can
      // discard unread terminal bytes on Linux under concurrent CI load.
      args: ["-c", 'read line; printf "received:%s\\n" "$line"; read finish; exit 7'],
      interactive: false,
      onOutput: (data) => (local += data),
      signal: AbortSignal.timeout(10000),
    });
    assert.equal(code, 7);
    assert.match(output, /received:from-comment/, JSON.stringify({local,ack,exit,exchanges}));
    assert.match(local, /received:from-comment/);
    assert.equal(ack, 2);
    assert.equal(exit, 7);
    assert.ok(exchanges >= 2);
  } finally {
    await new Promise<void>((r) => server.close(() => r()));
  }
});

test("exits promptly when the relay hangs after the child exits", async () => {
  let exchanges = 0;
  const server = createServer(async (req, res) => {
    for await (const _ of req) { /* drain request */ }
    if (req.url === "/api/remote/sessions") {
      res.setHeader("Content-Type", "application/json");
      res.end(JSON.stringify({ id: "shutdown", runnerKey: "runner" }));
    } else {
      exchanges++;
      // Deliberately never respond: shutdown must cancel the pending exchange.
    }
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  const address = server.address() as { port: number };
  const start = Date.now();
  try {
    const code = await runRemote({
      client: new HttpClient({ connection: { server: `http://127.0.0.1:${address.port}`, token: "test" } }),
      command: "/bin/sh",
      args: ["-c", "sleep 0.1; exit 0"],
      interactive: false,
      onOutput: () => {},
    });
    assert.equal(code, 0);
    assert.ok(exchanges > 0);
    assert.ok(Date.now() - start < 3000, "must not wait for the 10 second request timeout");
  } finally {
    server.closeAllConnections();
    await new Promise<void>((r) => server.close(() => r()));
  }
});

test("interactive exit detaches late input and resize while flushing the final exchange", async (t) => {
  const tty = Object.getOwnPropertyDescriptor(process.stdin, "isTTY");
  const raw = Object.getOwnPropertyDescriptor(process.stdin, "setRawMode");
  Object.defineProperty(process.stdin, "isTTY", { value: true, configurable: true });
  Object.defineProperty(process.stdin, "setRawMode", { value: () => process.stdin, configurable: true });
  t.after(() => {
    if (tty) Object.defineProperty(process.stdin, "isTTY", tty);
    else delete (process.stdin as { isTTY?: boolean }).isTTY;
    if (raw) Object.defineProperty(process.stdin, "setRawMode", raw);
    else delete (process.stdin as { setRawMode?: unknown }).setRawMode;
  });
  t.mock.method(process.stdin, "resume", () => process.stdin);
  t.mock.method(process.stdin, "pause", () => process.stdin);
  let messages = "";
  t.mock.method(process.stderr, "write", (data: string) => { messages += data; return true; });
  const inputListeners = process.stdin.listenerCount("data");
  const resizeListeners = process.stdout.listenerCount("resize");
  let sawExit = false;
  t.mock.method(globalThis, "fetch", async (_url: string, init: RequestInit) => {
    const body = JSON.parse(String(init.body));
    if (!body.runnerKey) return Response.json({ id: "exit", runnerKey: "runner" });
    if (body.exitCode !== undefined) {
      sawExit = true;
      assert.equal(process.stdin.listenerCount("data"), inputListeners);
      assert.equal(process.stdout.listenerCount("resize"), resizeListeners);
      process.stdin.emit("data", Buffer.from("\x03"));
      process.stdout.emit("resize");
    }
    return Response.json({ controller: "local", inputs: [] });
  });
  const code = await runRemote({
    client: new HttpClient({ connection: { server: "https://example.com", token: "test" } }),
    command: "/bin/sh", args: ["-c", "exit 0"], interactive: true,
    onOutput: () => {},
  });
  assert.equal(code, 0);
  assert.ok(sawExit);
  assert.match(messages, /Closing session/);
  assert.match(messages, /Session closed/);
  assert.doesNotMatch(messages, /remote access interrupted/);
});

test("mobile dimensions survive local terminal replies and typing", async (t) => {
  const tty = Object.getOwnPropertyDescriptor(process.stdin, "isTTY");
  const raw = Object.getOwnPropertyDescriptor(process.stdin, "setRawMode");
  Object.defineProperty(process.stdin, "isTTY", { value: true, configurable: true });
  Object.defineProperty(process.stdin, "setRawMode", { value: () => process.stdin, configurable: true });
  t.after(() => {
    if (tty) Object.defineProperty(process.stdin, "isTTY", tty);
    else delete (process.stdin as { isTTY?: boolean }).isTTY;
    if (raw) Object.defineProperty(process.stdin, "setRawMode", raw);
    else delete (process.stdin as { setRawMode?: unknown }).setRawMode;
  });
  t.mock.method(process.stdin, "resume", () => process.stdin);
  t.mock.method(process.stdin, "pause", () => process.stdin);
  t.mock.method(process.stderr, "write", () => true);
  const exchanges: Array<{ cols: number; rows: number; localControl?: boolean }> = [];
  t.mock.method(globalThis, "fetch", async (_url: string, init: RequestInit) => {
    const body = JSON.parse(String(init.body));
    if (!body.runnerKey) return Response.json({ id: "mobile", runnerKey: "runner" });
    exchanges.push(body);
    if (exchanges.length === 2) {
      // A terminal replies to the harness's cursor-position query after its redraw.
      process.stdin.emit("data", Buffer.from("\x1b[12;5R"));
      process.stdin.emit("data", Buffer.from("hello"));
    }
    return Response.json({ controller: "web", inputs: exchanges.length === 1
      ? [{ id: 1, kind: "resize", source: "keyboard", cols: 41, rows: 32 }]
      : [] });
  });
  const code = await runRemote({
    client: new HttpClient({ connection: { server: "https://example.com", token: "test" } }),
    command: "/bin/sh", args: ["-c", "sleep 1; exit 0"], interactive: true,
    onOutput: () => {},
  });
  assert.equal(code, 0);
  assert.ok(exchanges.length >= 3);
  for (const frame of exchanges.slice(1)) {
    assert.equal(frame.cols, 41);
    assert.equal(frame.rows, 32);
    assert.ok(!frame.localControl, "terminal replies must not reclaim dimensions");
  }
});

test("retries the same batch after a lost response and recreates a missing session without restarting the PTY", async (t) => {
  let registrations = 0;
  let calls = 0;
  const urls: string[] = [];
  let failedBatch: unknown;
  let local = "";
  let observedOutput = "";
  t.mock.method(globalThis, "fetch", async (url: string, init: RequestInit) => {
    const body = JSON.parse(String(init.body));
    if (!body.runnerKey) {
      registrations++;
      assert.match(body.recoveryKey, /^[a-f0-9]{64}$/);
      return Response.json({ id: "session-1", runnerKey: `key-${registrations}` });
    }
    calls++;
    if (calls === 1) {
      failedBatch = body;
      throw new TypeError("fetch failed");
    }
    if (calls === 2) {
      assert.deepEqual(body, failedBatch, "retry preserves output sequence and input acknowledgement");
      return Response.json({ controller: "local", inputs: [{ id: 1, kind: "input", data: "first\r" }] });
    }
    if (calls === 3) return Response.json({ error: "Session not found" }, { status: 404 });
    assert.match(String(url), /session-1\/exchange$/);
    assert.equal(body.runnerKey, "key-2");
    if (calls === 4) {
      assert.equal(body.ack, 0);
      assert.equal(body.outputSeq, 1);
    }
    observedOutput += body.output;
    return Response.json({ controller: "local", inputs: !body.ack
      ? [{ id: 1, kind: "input", data: "second\r" }]
      : body.ack === 1 && observedOutput.includes("result:first:second")
        ? [{ id: 2, kind: "input", data: "finish\r" }]
        : [] });
  });
  const code = await runRemote({
    client: new HttpClient({ connection: { server: "https://example.com", token: "test" } }),
    // Wait for the relay to observe the result before exiting. Linux PTYs can
    // discard unread bytes on immediate exit when other CI tests are busy.
    command: "/bin/sh", args: ["-c", 'read a; read b; printf "result:%s:%s\\n" "$a" "$b"; read finish; test "$finish" = finish'],
    interactive: false, onOutput: data => { local += data; }, onSession: url => urls.push(url),
    signal: AbortSignal.timeout(10000),
  });
  assert.equal(code, 0);
  assert.equal(registrations, 2);
  assert.equal(urls.length, 2);
  assert.equal(urls[0], urls[1]);
  assert.match(local, /result:first:second/);
  assert.match(observedOutput, /result:first:second/);
});

test("output overflow keeps the local PTY running and the relay reconnecting", async (t) => {
  let calls = 0;
  let bytes = 0;
  let recovered = false;
  t.mock.method(globalThis, "fetch", async (_url: string, init: RequestInit) => {
    const body = JSON.parse(String(init.body));
    if (!body.runnerKey) return Response.json({ id: "overflow", runnerKey: "runner" });
    calls++;
    if (calls < 3) return Response.json({ error: "Unavailable" }, { status: 503 });
    recovered = true;
    assert.ok(body.output.length <= 60000);
    return Response.json({ controller: "local", inputs: body.ack ? [] : [{ id: 1, kind: "input", data: "done\r" }] });
  });
  const code = await runRemote({
    client: new HttpClient({ connection: { server: "https://example.com", token: "test" } }),
    command: process.execPath,
    args: ["-e", "process.stdout.write('x'.repeat(2 * 1024 * 1024)); process.stdin.once('data', () => process.exit(0));"],
    interactive: false, onOutput: data => { bytes += data.length; },
    signal: AbortSignal.timeout(10000),
  });
  assert.equal(code, 0);
  assert.ok(bytes >= 2 * 1024 * 1024);
  assert.ok(recovered);
});

for (const status of [401, 403, 410]) test(`HTTP ${status} stops retries but lets the local child finish`, async (t) => {
  let calls = 0;
  let local = "";
  t.mock.method(globalThis, "fetch", async (_url: string, init: RequestInit) => {
    const body = JSON.parse(String(init.body));
    if (!body.runnerKey) return Response.json({ id: "auth", runnerKey: "runner" });
    calls++;
    return Response.json({ error: "Unauthorized" }, { status });
  });
  const code = await runRemote({
    client: new HttpClient({ connection: { server: "https://example.com", token: "test" } }),
    command: "/bin/sh", args: ["-c", "sleep 0.3; echo still-local"],
    interactive: false, onOutput: data => { local += data; },
    signal: AbortSignal.timeout(5000),
  });
  assert.equal(code, 0);
  assert.equal(calls, 1);
  assert.match(local, /still-local/);
});

test("child exit interrupts reconnect backoff promptly", async (t) => {
  let calls = 0;
  t.mock.method(globalThis, "fetch", async (_url: string, init: RequestInit) => {
    const body = JSON.parse(String(init.body));
    if (!body.runnerKey) return Response.json({ id: "backoff", runnerKey: "runner" });
    calls++;
    return Response.json({ error: "Unavailable" }, { status: 503 });
  });
  const start = Date.now();
  const code = await runRemote({
    client: new HttpClient({ connection: { server: "https://example.com", token: "test" } }),
    command: "/bin/sh", args: ["-c", "sleep 1.7; exit 0"],
    interactive: false, onOutput: () => {},
    signal: AbortSignal.timeout(6000),
  });
  assert.equal(code, 0);
  assert.equal(calls, 3);
  assert.ok(Date.now() - start < 3300, "shutdown must interrupt the two-second reconnect wait");
});

test("relay restart restores acknowledged history at the original link, including a lost registration response", async (t) => {
  const { RemoteRegistry } = await import("../../app/lib/remote/registry");
  const registry = new RemoteRegistry();
  t.after(() => registry.clear());
  let registered = 0;
  let restarted = false;
  let restored = false;
  let recoveryOutputReceived = false;
  let originalId = "";
  t.mock.method(globalThis, "fetch", async (url: string, init: RequestInit) => {
    const payload = JSON.parse(String(init.body));
    if (!payload.runnerKey) {
      const session = registry.create("owner", payload);
      registered++;
      if (!originalId) originalId = session.id;
      assert.equal(session.id, originalId);
      if (registered === 2) throw new TypeError("lost registration response");
      return Response.json(session);
    }
    assert.ok(String(url).includes(originalId));
    const before = await registry.view("owner", originalId, -1);
    if (!restarted && before.snapshot?.includes("BEFORE-RESTART")) {
      registry.clear();
      restarted = true;
      return Response.json({ error: "Session not found" }, { status: 404 });
    }
    await registry.exchange("owner", originalId, payload);
    const view = await registry.view("owner", originalId, -1);
    if (restarted && !restored && view.snapshot?.includes("BEFORE-RESTART")) {
      restored = true;
      registry.input("owner", originalId, "done\r");
    }
    // Keep the fixture alive until recovery output reaches the relay. Immediate-exit
    // flushing is exercised separately; this test owns replay and re-registration.
    if (!recoveryOutputReceived && view.snapshot?.includes("AFTER-RECOVERY")) {
      recoveryOutputReceived = true;
      registry.input("owner", originalId, "finish\r");
    }
    return Response.json(await registry.exchange("owner", originalId, payload));
  });
  const code = await runRemote({
    client: new HttpClient({ connection: { server: "https://example.com", token: "test" } }),
    command: "/bin/sh", args: ["-c", 'printf "BEFORE-RESTART\\n"; read line; echo AFTER-RECOVERY; read finish'],
    interactive: false, onOutput: () => {}, signal: AbortSignal.timeout(10000),
  });
  assert.equal(code, 0);
  assert.equal(registered, 3);
  assert.ok(restored);
  assert.ok(recoveryOutputReceived, "the recovered relay acknowledges output before the fixture exits");
  const snapshot = (await registry.view("owner", originalId, -1)).snapshot!;
  assert.equal(snapshot.split("BEFORE-RESTART").length, 2, "history is not duplicated");
  assert.match(snapshot, /AFTER-RECOVERY/);
});

import {pty} from '../src/pty';
test('Windows natural PTY exit releases ConPTY handles and still sends final output and exit',async(t)=>{
 const platform=Object.getOwnPropertyDescriptor(process,'platform')!;
 Object.defineProperty(process,'platform',{value:'win32',configurable:true});t.after(()=>Object.defineProperty(process,'platform',platform));
 t.mock.method(process,'kill',()=>assert.fail('Windows cleanup must not signal a numeric PID/group'));
 let killed=0;let onData:((value:string)=>void)|undefined;let onExit:((event:{exitCode:number})=>void)|undefined;
 t.mock.method(pty,'spawn',()=>({pid:12345,onData:(listener:(value:string)=>void)=>{onData=listener;return{dispose(){}};},onExit:(listener:(event:{exitCode:number})=>void)=>{onExit=listener;return{dispose(){}};},kill:()=>{killed++;},resize(){},write(){}} as unknown as import('node-pty').IPty));
 let output='';let reportedExit:number|undefined;let fired=false;
 const client=new HttpClient({connection:{server:'https://example.test',token:'test'},fetch:async(_url,init)=>{
  const body=JSON.parse(String(init?.body));if(!body.runnerKey)return Response.json({id:'natural-exit',runnerKey:'proof'});
  if(!fired){fired=true;onData!('final-native-output');onExit!({exitCode:7});}
  output+=body.output;reportedExit=body.exitCode;
  return Response.json({controller:'local',inputs:[]});
 }});
 assert.equal(await runRemote({client,command:'cmd.exe',args:[],interactive:false,managed:true,onOutput:()=>{}}),7);
 assert.equal(killed,1,'natural ConPTY exit must close its worker handles without a process-group signal');
 assert.equal(reportedExit,7);assert.equal(output,'final-native-output');
});


// Managed Codex and Claude must see a paste boundary before submit, not guess where a burst ended.
test('managed Codex comment input frames the paste and submits it once',async(t)=>{
 let onExit:((event:{exitCode:number})=>void)|undefined; const writes:string[]=[];
 t.mock.method(process,'kill',()=>true);
 t.mock.method(pty,'spawn',()=>({pid:12345,onData:()=>({dispose(){}}),onExit:(listener:(event:{exitCode:number})=>void)=>{onExit=listener;return{dispose(){}};},kill(){},resize(){},write(data:string){writes.push(data);if(data==='\r')onExit?.({exitCode:0});}} as unknown as import('node-pty').IPty));
 let sent=false,duplicateDelivered=false;const client=new HttpClient({connection:{server:'https://example.test',token:'test'},fetch:async(_url,init)=>{
  const body=JSON.parse(String(init?.body));if(!body.runnerKey)return Response.json({id:'paste-submit',runnerKey:'proof'});
  if(!sent){sent=true;return Response.json({controller:'local',inputs:[{id:1,kind:'input',source:'comment',data:JSON.stringify({type:'artifactbin.comment',request_id:'request-test',body:'Synthetic controlled request'})+'\r'}]});}
  if(body.ack===1&&!duplicateDelivered){duplicateDelivered=true;return Response.json({controller:'local',inputs:[{id:1,kind:'input',source:'comment',data:JSON.stringify({type:'artifactbin.comment',request_id:'request-test',body:'Synthetic controlled request'})+'\r'}]});}
  return Response.json({controller:'local',inputs:[]});
 }});
 assert.equal(await runRemote({client,command:'codex',args:[],interactive:false,managed:true,commentCommand:'/synthetic/afbin',onOutput:()=>{},signal:AbortSignal.timeout(3000)}),0);
 const wire=writes.join('');assert.ok(wire.startsWith('\x1b[200~'),'explicit bracketed paste start bypasses burst guessing');
 assert.ok(wire.endsWith('\x1b[201~\r'),'paste end precedes one distinct submit');
 assert.equal(writes.filter(value=>value==='\r').length,1,'submit once');
 assert.equal(duplicateDelivered,true,'relay repeated the already acknowledged input');
 const payload=JSON.parse(wire.slice('\x1b[200~'.length,-'\x1b[201~\r'.length));assert.equal(payload.request_id,'request-test');assert.equal(payload.cli_executable,'/synthetic/afbin');
});

test('managed Claude comment input preserves a large request in one framed paste',async(t)=>{
 let onExit:((event:{exitCode:number})=>void)|undefined; const writes:string[]=[];
 t.mock.method(process,'kill',()=>true);
 t.mock.method(pty,'spawn',()=>({pid:12345,onData:()=>({dispose(){}}),onExit:(listener:(event:{exitCode:number})=>void)=>{onExit=listener;return{dispose(){}};},kill(){},resize(){},write(data:string){writes.push(data);if(data==='\r')onExit?.({exitCode:0});}} as unknown as import('node-pty').IPty));
 const body='Synthetic request body. '.repeat(70);
 const original=JSON.stringify({type:'artifactbin.comment',artifact_id:'artifact-test',request_id:'request-test',body})+'\r';
 let delivered=false;const client=new HttpClient({connection:{server:'https://example.test',token:'test'},fetch:async(_url,init)=>{
  const payload=JSON.parse(String(init?.body));if(!payload.runnerKey)return Response.json({id:'claude-paste',runnerKey:'proof'});
  if(!delivered){delivered=true;return Response.json({controller:'local',inputs:[{id:1,kind:'input',source:'comment',data:original}]});}
  return Response.json({controller:'local',inputs:[]});
 }});
 assert.equal(await runRemote({client,command:'claude',args:[],interactive:false,managed:true,commentCommand:'/synthetic/afbin',onOutput:()=>{},signal:AbortSignal.timeout(3000)}),0);
 const wire=writes.join('');assert.ok(wire.startsWith('\x1b[200~'),'large comment starts with an explicit bracketed paste');
 assert.ok(wire.endsWith('\x1b[201~\r'),'paste end precedes a distinct submit');
 assert.equal(writes.filter(value=>value==='\r').length,1,'request is submitted once');
 const payload=JSON.parse(wire.slice('\x1b[200~'.length,-'\x1b[201~\r'.length));
 assert.equal(payload.artifact_id,'artifact-test');assert.equal(payload.request_id,'request-test');assert.equal(payload.body,body);assert.equal(payload.cli_executable,'/synthetic/afbin');
});

test('unmanaged Claude comments and manual Codex keystrokes retain terminal input semantics',async()=>{
 const comment=JSON.stringify({type:'artifactbin.comment',request_id:'other-provider',body:'Keep provider input generic'})+'\r';
 const otherWrites:string[]=[];
 await deliverRemoteInput(data=>otherWrites.push(data),comment,{source:'comment',command:'claude',commentCommand:'/synthetic/afbin'});
 const otherInput=otherWrites.join('');
 assert.ok(otherInput.endsWith('\r'));
 assert.ok(!otherInput.includes('\x1b[200~'));
 const otherPayload=JSON.parse(otherInput.slice(0,-1));
 assert.equal(otherPayload.cli_executable,'/synthetic/afbin');
 assert.match(otherPayload.instruction,/Use the absolute cli_executable/);
 const manualWrites:string[]=[];
 const manualOptions={source:'keyboard' as const,command:'codex',managed:true,commentCommand:'/synthetic/afbin'};
 await deliverRemoteInput(data=>manualWrites.push(data),'typed',manualOptions);
 await deliverRemoteInput(data=>manualWrites.push(data),'\r',manualOptions);
 await deliverRemoteInput(data=>manualWrites.push(data),'\x1b',manualOptions);
 assert.deepEqual(manualWrites,['typed','\r','\x1b']);
 assert.ok(!manualWrites.join('').includes('\x1b[200~'));
});

test('managed Codex and Claude pastes omit Enter if the PTY exits before submission',async()=>{
 for(const command of ['codex','claude']){
  const writes:string[]=[];
  await deliverRemoteInput(data=>writes.push(data),JSON.stringify({type:'artifactbin.comment',request_id:'exit-before-submit',body:'Do not submit after exit'})+'\r',{
   source:'comment',command,managed:true,commentCommand:'/synthetic/afbin',canWrite:()=>false,
  });
  assert.equal(writes[0],'\x1b[200~');
  assert.equal(writes.at(-1),'\x1b[201~');
  assert.ok(!writes.includes('\r'));
 }
});

test('a hosted bootstrap failure preserves the reserved agent identity for recovery',async()=>{
 const requests:string[]=[];
 const server=createServer(async(req,res)=>{for await(const _ of req){}requests.push(req.method+' '+req.url);res.setHeader('Content-Type','application/json');res.end(JSON.stringify({id:'reserved',runnerKey:'mxmx_test_proof'}));});
 await new Promise<void>(resolve=>server.listen(0,'127.0.0.1',resolve));
 try{
  await assert.rejects(runRemote({client:new HttpClient({connection:{server:`http://127.0.0.1:${(server.address() as {port:number}).port}`,token:'mxmx_test_token'}}),command:'claude',args:[],interactive:false,managed:true,hostedSessionId:'reserved',hostedGeneration:'one',prepare:async()=>{throw Error('bootstrap failure');}}),/bootstrap failure/);
  assert.deepEqual(requests,['POST /api/remote/sessions']);
 }finally{await new Promise<void>(resolve=>server.close(()=>resolve()));}
});


test('managed native composer lines settle after framed paste before a single submit',async()=>{
 for(const source of ['keyboard','comment'] as const){
  const writes:{data:string;time:number}[]=[];
  await deliverRemoteInput(data=>writes.push({data,time:performance.now()}),'Synthetic request '+ 'x'.repeat(7000)+'\r',{
   source,command:'codex',managed:true,...(source==='comment'?{commentCommand:'/synthetic/afbin'}:{}),
  });
  assert.equal(writes[0]?.data,'\x1b[200~','composer content must bypass native burst heuristics');
  assert.equal(writes[1]?.data,'Synthetic request '+ 'x'.repeat(7000),'paste payload stays byte-for-byte complete and excludes the submit CR');
  assert.equal(writes.at(-2)?.data,'\x1b[201~');
  assert.equal(writes.at(-1)?.data,'\r');
  assert.ok(writes.at(-1)!.time-writes.at(-2)!.time>=190,'submit waits for the native paste to settle');
  assert.equal(writes.filter(write=>write.data==='\r').length,1);
 }
});

test('native composer does not submit if the PTY exits during paste settling',async()=>{
 for(const source of ['keyboard','comment'] as const){
  let alive=true;const writes:string[]=[];
  await deliverRemoteInput(data=>{writes.push(data);if(data==='\x1b[201~')setTimeout(()=>{alive=false;},10);},'Synthetic controlled request\r',{
   source,command:'codex',managed:true,...(source==='comment'?{commentCommand:'/synthetic/afbin'}:{}),canWrite:()=>alive,
  });
  assert.equal(writes.at(-1),'\x1b[201~');
  assert.ok(!writes.includes('\r'),'a dead PTY cannot receive submit');
 }
});


test('unattended native terminal answers device and cursor queries without browser input',async(t)=>{
 let onData:((value:string)=>void)|undefined,onExit:((event:{exitCode:number})=>void)|undefined;
 const writes:string[]=[];let queried=false,exchanges=0;
 t.mock.method(process,'kill',()=>true);
 t.mock.method(pty,'spawn',()=>({pid:12345,onData:(listener:(value:string)=>void)=>{onData=listener;return{dispose(){}};},onExit:(listener:(event:{exitCode:number})=>void)=>{onExit=listener;return{dispose(){}};},resize(){},kill(){},write(data:string){writes.push(data);if(data==='\x1b[1;1R'){onData?.('NATIVE_TERMINAL_READY');onExit?.({exitCode:0});}}} as unknown as import('node-pty').IPty));
 const client=new HttpClient({connection:{server:'https://example.test',token:'test'},fetch:async(_url,init)=>{
  const body=JSON.parse(String(init?.body));if(!body.runnerKey)return Response.json({id:'native-query',runnerKey:'proof'});
  if(!queried){queried=true;onData?.('\x1b[c\x1b[6n');}
  if(++exchanges===5&&!writes.length)onExit?.({exitCode:1});
  return Response.json({controller:'web',inputs:[]});
 }});
 assert.equal(await runRemote({client,command:'opencode',args:[],interactive:false,managed:true,onOutput:()=>{}}),0,'native startup must complete with no human or browser keystrokes');
 assert.deepEqual(writes,['\x1b[?1;2c','\x1b[1;1R']);
});
