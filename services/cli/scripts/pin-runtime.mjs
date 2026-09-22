/** Maintainer step: review producer artifacts, then commit exact executable and transport hashes. */
import {readFile,writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {createHash} from 'node:crypto';
import {gunzipSync} from 'node:zlib';
import assert from 'node:assert/strict';
import {runtimePin} from './runtime.mjs';
const [release,directory]=process.argv.slice(2);
assert.match(release??'',/^cli-node-v\d+\.\d+\.\d+-r\d+$/,'Pass a versioned runtime release tag');
assert.ok(directory,'Pass the downloaded runtime asset directory');
const lock={schema:1,release,version:release.slice('cli-node-v'.length).replace(/-r\d+$/,''),platforms:{}};
const digest=bytes=>createHash('sha256').update(bytes).digest('hex');
for(const target of ['darwin-arm64','darwin-x64','linux-arm64','linux-x64']){
 const name=`afbin-node-${target}`,entry=JSON.parse(await readFile(join(directory,`${name}.pin.json`),'utf8'));
 assert.ok(Number.isSafeInteger(entry.size)&&entry.size>0&&entry.size<=134217728,'Runtime size limit');
 const compressed=await readFile(join(directory,`${name}.gz`));
 assert.equal(digest(compressed),entry.gzipSha256,'Runtime transport checksum');
 const bytes=gunzipSync(compressed,{maxOutputLength:entry.size});
 assert.equal(bytes.length,entry.size);assert.equal(digest(bytes),entry.sha256,'Runtime executable checksum');
 lock.platforms[target]=entry;
 const [platform,arch]=target.split('-');runtimePin(lock,platform,arch);
}
const previous=JSON.parse(await readFile(new URL('../runtime-lock.json',import.meta.url),'utf8'));
const windows=previous.platforms?.['win32-x64'];
if(windows){
 assert.equal(windows.recipe.version,lock.version,'Update the official Windows runtime pin to the new Node version before pinning the other platforms.');
 lock.platforms['win32-x64']=windows;runtimePin(lock,'win32','x64');
}
await writeFile(new URL('../runtime-lock.json',import.meta.url),JSON.stringify(lock,null,2)+'\n');
console.log(`Pinned ${release}; review runtime-lock.json, then run CLI CI using the downloaded runtimes.`);
