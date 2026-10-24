import {it,expect} from 'vitest';
import {readFileSync,readdirSync,mkdtempSync,mkdirSync,writeFileSync,existsSync,rmSync} from 'node:fs';
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
 expect(script).toContain('runuser -u nobody -- make check');
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
  writeFileSync(join(bin,'dpkg-query'),`#!/bin/sh\nprintf '%s\\n' /bin/sh "$INVENTORY_DOCUMENT"\n`,{mode:0o755});
  execFileSync('sh',['-eu','-c',helper+'\ncopy_inventory ignored "$1"','inventory-fixture',destination],{env:{...process.env,PATH:bin+':'+process.env.PATH,INVENTORY_DOCUMENT:documentation}});
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
