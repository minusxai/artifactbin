#!/usr/bin/env node
/** Final-image native probes; no Python, compiler, printer service or external network. */
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {spawn,execFileSync} from 'node:child_process';
import {createServer} from 'node:http';
import {readFile,mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {pathToFileURL} from 'node:url';

export function ippResponse(request) {
  assert.ok(request.length >= 8, 'Complete IPP header');
  assert.ok(request.subarray(0,2).equals(Buffer.from([1,1])) || request.subarray(0,2).equals(Buffer.from([2,0])), 'Supported IPP version');
  assert.equal(request.readUInt16BE(2),11,'Normal Get-Printer-Attributes operation');
  const attribute=(tag,name,value)=>{
    const key=Buffer.from(name),text=Buffer.from(value),lengths=Buffer.alloc(4);
    lengths.writeUInt16BE(key.length,0);lengths.writeUInt16BE(text.length,2);
    return Buffer.concat([Buffer.from([tag]),lengths.subarray(0,2),key,lengths.subarray(2),text]);
  };
  return Buffer.concat([request.subarray(0,2),Buffer.from([0,0]),request.subarray(4,8),Buffer.from([1]),
    attribute(0x47,'attributes-charset','utf-8'),attribute(0x48,'attributes-natural-language','en'),
    Buffer.from([4]),attribute(0x42,'printer-name','fixture'),Buffer.from([3])]);
}

function run(program,args,cwd,timeout=20_000) {
  return new Promise((done,fail)=>{
    const env={...process.env};delete env.LD_LIBRARY_PATH;delete env.LD_PRELOAD;
    const child=spawn(program,args,{cwd,env,stdio:'inherit'});
    const timer=setTimeout(()=>child.kill('SIGKILL'),timeout);
    child.once('error',error=>{clearTimeout(timer);fail(error);});
    child.once('exit',(code,signal)=>{clearTimeout(timer);code===0?done():fail(Error(`${program} failed (${signal??code})`));});
  });
}

async function checkBrowserLibraries(proof='/test-tools') {
  const cwd=await mkdtemp(join(tmpdir(),'runtime-native-'));
  let requests=0,fixtureError;
  const server=createServer(async(request,response)=>{
    try {
      assert.equal(request.method,'POST');assert.equal(request.url,'/printers/fixture');
      assert.equal(request.headers['content-type'],'application/ipp');
      const chunks=[];let length=0;
      for await(const chunk of request){length+=chunk.length;assert.ok(length<=65536,'Bounded ordinary IPP request');chunks.push(chunk);}
      const payload=ippResponse(Buffer.concat(chunks));requests++;
      response.writeHead(200,{'content-type':'application/ipp','content-length':payload.length});response.end(payload);
    } catch(error){fixtureError=error;response.writeHead(500);response.end();}
  });
  try {
    await new Promise((done,fail)=>{server.once('error',fail);server.listen(0,'127.0.0.1',done);});
    const payloads=JSON.parse(await readFile(join(proof,'browser-native-payloads.json'),'utf8'));
    assert.ok(Object.keys(payloads).length>=8,'Complete rebuilt browser native payload manifest');
    for(const [path,digest] of Object.entries(payloads)){
      assert.ok(path.startsWith('/usr/')&&!path.split('/').includes('..'));assert.match(digest,/^[a-f0-9]{64}$/);
      assert.equal(createHash('sha256').update(await readFile(path)).digest('hex'),digest,`Installed native package bytes: ${path}`);
    }
    await run(join(proof,'check-ipp'),[String(server.address().port)],cwd,15_000);
    if(fixtureError)throw fixtureError;
    assert.equal(requests,1,'Actual native libcups request reached the loopback fixture');
    const receipt=JSON.parse(await readFile('/usr/share/doc/libcups2t64/runtime-source.json','utf8'));
    assert.equal(receipt.version,'2.4.20-1+runtime1');assert.equal(receipt.retained_soname,'libcups.so.2');
    const triplet=process.arch==='arm64'?'aarch64-linux-gnu':process.arch==='x64'?'x86_64-linux-gnu':null;
    assert.ok(triplet,'Explicit supported Company image architecture');
    const library=await readFile(`/usr/lib/${triplet}/libcups.so.2`);
    assert.equal(createHash('sha256').update(library).digest('hex'),receipt.library_sha256,'Installed CUPS bytes match the source receipt');
    const packages=execFileSync('dpkg-query',['-W','-f=${binary:Package}\t${source:Package}\t${Version}\n'],{encoding:'utf8'}).trim().split('\n');
    const xorgSources=new Set(['libx11','libxi','libxpm','libxrender','xorg-server','x11-xkb-utils']);
    for(const line of packages){
      const [qualified,source,version]=line.split('\t'),name=qualified.split(':')[0];
      if(!xorgSources.has(source)||name==='xserver-common')continue;
      const record=JSON.parse(await readFile(`/usr/share/doc/${name}/runtime-source.json`,'utf8'));
      assert.equal(record.source,source);assert.equal(record.version,version,'Every final installed Xorg family received its replacement');
      assert.ok(version.endsWith('-1+runtime1'));assert.ok(record.replaced.length>0);
      assert.match(record.archive.sha256,/^[a-f0-9]{64}$/);
    }
    await run(join(proof,'check-xml'),[],cwd);
    const xml=JSON.parse(await readFile('/usr/share/doc/libxml2/runtime-source.json','utf8'));
    assert.equal(xml.patches.length,8,'All reviewed XML backports retained');
    for(const patch of xml.patches)assert.match(patch.sha256,/^[a-f0-9]{64}$/);
    await run('sh',[join(proof,'check-display.sh'),join(proof,'check-xorg')],cwd,30_000);
    await run('sh',[join(proof,'verify-sqlite.sh'),join(proof,'sqlite')],cwd);
    console.log('PASS final installed XML, CUPS, SQLite and Xorg native consumers');
  } finally {
    server.closeAllConnections();await new Promise(done=>server.close(done));
    await rm(cwd,{recursive:true,force:true});
  }
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href)await checkBrowserLibraries(process.argv[2]);
