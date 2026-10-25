import {it,expect} from 'vitest';
import {readFileSync,readdirSync,mkdtempSync,mkdirSync,writeFileSync,existsSync,rmSync,realpathSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {execFileSync} from 'node:child_process';
const source=new URL('../../deploy/company/runtime-source/',import.meta.url);
it('verifies every vendored security patch and rejects altered bytes',()=>{
 const directory=new URL('tar-patches/',source);
 const manifest=readFileSync(new URL('SHA256SUMS',directory),'utf8').trim().split('\n');
 expect(manifest).toHaveLength(19);
 expect(readdirSync(directory).filter(name=>name.endsWith('.patch')).sort()).toEqual(Array.from({length:19},(_,index)=>`${String(index).padStart(2,'0')}.patch`));
 for(const line of manifest){
  const [expected,name]=line.trim().split(/\s+/),bytes=readFileSync(new URL(name,directory));
  const digest=value=>createHash('sha256').update(value).digest('hex');
  expect(digest(bytes),name).toBe(expected);
  expect(digest(Buffer.concat([bytes,Buffer.from('\nchanged')]))).not.toBe(expected);
 }
 expect(readFileSync(new URL('SOURCE',directory),'utf8')).toContain('e4e337c57a86b5faa686872c6d7f22d58686e66c');
});
it('keeps source suites and runtime ABI metadata in the same-base builder',()=>{
 execFileSync('sh',['-n',new URL('build.sh',source).pathname]);
 const script=readFileSync(new URL('build.sh',source),'utf8');
 expect(script).toContain('sha256sum -c -');
 expect(script).toMatch(/cd \/patches\n\s*sha256sum -c SHA256SUMS/);
 expect(script).toContain('make check');
 expect(script).toContain('runuser -u nobody -- make check TESTSUITEFLAGS=-j4');
 expect(script).toContain('--enable-fnmatch');
 expect(script).toContain('timeout 5 src/dash');
 expect(script).toContain('dpkg-shlibdeps -O');
 expect(script).toContain('Source: pcre2');expect(script).toContain('Source: tar');expect(script).toContain('Source: dash');
 expect(script).toContain('Source: expat');
});

it('normalizes legacy executable inventory while retaining ancillary file bytes',()=>{
 const directory=mkdtempSync(join(tmpdir(),'runtime-inventory-'));
 try{
  const documentation=join(directory,'documentation','tar'),destination=join(directory,'package');
  mkdirSync(join(directory,'documentation'));writeFileSync(documentation,'ancillary package information');
  const script=readFileSync(new URL('build.sh',source),'utf8');
  const helper=script.slice(script.indexOf('copy_inventory() {'),script.indexOf('build_pcre2() {'));
  const bin=join(directory,'bin');mkdirSync(bin);
  // This fixture verifies paths and bytes, not protected macOS system-file flags.
  if(process.platform==='darwin')writeFileSync(join(bin,'cp'),'#!/bin/sh\nshift\nexec /bin/cp "$@"\n',{mode:0o755});
  writeFileSync(join(bin,'dpkg-query'),`#!/bin/sh\nprintf '%s\\n' /bin/sh "$INVENTORY_SHELL_TARGET" "$INVENTORY_DOCUMENT"\n`,{mode:0o755});
  execFileSync('sh',['-eu','-c',helper+'\ncopy_inventory ignored "$1"','inventory-fixture',destination],{env:{...process.env,PATH:bin+':'+process.env.PATH,INVENTORY_DOCUMENT:documentation,INVENTORY_SHELL_TARGET:realpathSync('/bin/sh')}});
  expect(readFileSync(join(destination,'usr/bin/sh'))).toEqual(readFileSync('/bin/sh'));
  expect(existsSync(join(destination,'bin/sh'))).toBe(false);
  expect(readFileSync(join(destination,documentation),'utf8')).toBe('ancillary package information');
 }finally{rmSync(directory,{recursive:true,force:true});}
});
it('verifies both bounded Expat patches and their public API regression source',()=>{
 const directory=new URL('expat-patches/',source);
 const manifest=readFileSync(new URL('SHA256SUMS',directory),'utf8').trim().split('\n');
 expect(manifest).toHaveLength(3);
 for(const line of manifest){const [digest,name]=line.trim().split(/\s+/);expect(createHash('sha256').update(readFileSync(new URL(name,directory))).digest('hex'),name).toBe(digest);}
 const origin=readFileSync(new URL('SOURCE',directory),'utf8');
 expect(origin).toContain('d8f31e647a4d1eda088e89354f4769b0dad303d3');
 expect(origin).toContain('c30145b28632b31f805d57f9838ba36b8db99367');
 const script=readFileSync(new URL('build.sh',source),'utf8');
 expect(script).toContain('patch --batch --fuzz=0');
 expect(script).toContain('timeout 15 /check-expat');
});
it('retains maintainer hooks, modes and package relationships',()=>{
 const directory=mkdtempSync(join(tmpdir(),'runtime-controls-'));
 try{
  const bin=join(directory,'bin'),destination=join(directory,'package');mkdirSync(bin);mkdirSync(destination);mkdirSync(join(destination,'DEBIAN'));
  const hook=join(directory,'preinst');writeFileSync(hook,'#!/bin/sh\nexit 0\n',{mode:0o755});
  writeFileSync(join(destination,'DEBIAN/control'),'Package: fixture\nDepends: libc6 (>= 2.38)\n');
  writeFileSync(join(bin,'dpkg-query'),`#!/bin/sh
case "$1" in
 --control-path) if test "$3" = preinst; then printf '%s\\n' "$CONTROL_HOOK"; else exit 1; fi ;;
 -W) case "$2" in
  *Pre-Depends*) printf '%s' 'libc6 (>= 2.34)' ;;
  *Breaks*) printf '%s' 'old-runtime (<< 1)' ;;
  *Provides*) printf '%s' 'runtime-interface' ;;
 esac ;;
esac
`,{mode:0o755});
  const script=readFileSync(new URL('build.sh',source),'utf8');
  const helper=script.slice(script.indexOf('preserve_controls() {'),script.indexOf('build_pcre2() {'));
  execFileSync('sh',['-eu','-c',helper+'\npreserve_controls fixture "$1"','controls-fixture',destination],{env:{...process.env,PATH:bin+':'+process.env.PATH,CONTROL_HOOK:hook}});
  const control=readFileSync(join(destination,'DEBIAN/control'),'utf8');
  expect(control).toContain('Pre-Depends: libc6 (>= 2.34)');expect(control).toContain('Breaks: old-runtime (<< 1)');expect(control).toContain('Provides: runtime-interface');
  expect(readFileSync(join(destination,'DEBIAN/preinst'),'utf8')).toBe(readFileSync(hook,'utf8'));
  execFileSync('test',['-x',join(destination,'DEBIAN/preinst')]);
 }finally{rmSync(directory,{recursive:true,force:true});}
});

it('preserves the IPP request identity and rejects malformed native requests',async()=>{
 const {ippResponse}=await import('../../deploy/company/runtime-source/browser/check-browser-libraries.mjs');
 const request=Buffer.from([2,0,0,11,0x12,0x34,0x56,0x78,3]);
 const response=ippResponse(request);
 expect([...response.subarray(0,8)]).toEqual([2,0,0,0,0x12,0x34,0x56,0x78]);
 let offset=9;const attributes=[];
 while(response[offset]!==3){
  if(response[offset]===4){offset++;continue;}
  const tag=response[offset++],nameLength=response.readUInt16BE(offset);offset+=2;
  const name=response.subarray(offset,offset+nameLength).toString();offset+=nameLength;
  const valueLength=response.readUInt16BE(offset);offset+=2;
  const value=response.subarray(offset,offset+valueLength).toString();offset+=valueLength;
  attributes.push([tag,name,value]);
 }
 expect(attributes).toEqual([[0x47,'attributes-charset','utf-8'],[0x48,'attributes-natural-language','en'],[0x42,'printer-name','fixture']]);
 expect(()=>ippResponse(Buffer.alloc(7))).toThrow('Complete IPP header');
 expect(()=>ippResponse(Buffer.from([2,0,0,2,0,0,0,1]))).toThrow('Get-Printer-Attributes');
 expect(()=>ippResponse(Buffer.from([9,0,0,11,0,0,0,1]))).toThrow('Supported IPP version');
});
it('binds selective browser source inputs to their reviewed manifests',()=>{
 const browser=new URL('browser/',source);
 const sqlite=JSON.parse(readFileSync(new URL('sqlite/consumer-manifest.json',browser),'utf8'));
 for(const [name,digest] of Object.entries(sqlite))expect(createHash('sha256').update(readFileSync(new URL('sqlite/'+name,browser))).digest('hex'),name).toBe(digest);
 for(const family of ['xml/patches','cups']){
  const directory=new URL(family+'/',browser);
  for(const line of readFileSync(new URL('SHA256SUMS',directory),'utf8').trim().split('\n')){
   const [digest,name]=line.trim().split(/\s+/);
   expect(createHash('sha256').update(readFileSync(new URL(name,directory))).digest('hex'),name).toBe(digest);
  }
 }
});

it('binds rebuilt ELF bytes and excludes package documentation from the native manifest',()=>{
 const directory=mkdtempSync(join(tmpdir(),'native-manifest-'));
 try{
  const bin=join(directory,'bin'),packages=join(directory,'packages'),output=join(directory,'manifest.json');mkdirSync(bin);mkdirSync(packages);
  writeFileSync(join(packages,'fixture.deb'),'fixture archive');
  writeFileSync(join(bin,'dpkg-deb'),`#!/bin/sh
mkdir -p "$3/usr/lib" "$3/usr/share/doc"
printf '\\177ELFrebuilt-native-payload' > "$3/usr/lib/libfixture.so.1"
printf 'package documentation' > "$3/usr/share/doc/fixture"
`,{mode:0o755});
  execFileSync(process.execPath,[new URL('browser/write-payload-manifest.mjs',source).pathname,packages,output],{env:{...process.env,PATH:bin+':'+process.env.PATH}});
  const bytes=Buffer.concat([Buffer.from([0x7f]),Buffer.from('ELFrebuilt-native-payload')]);
  expect(JSON.parse(readFileSync(output,'utf8'))).toEqual({'/usr/lib/libfixture.so.1':createHash('sha256').update(bytes).digest('hex')});
 }finally{rmSync(directory,{recursive:true,force:true});}
});
