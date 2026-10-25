import {it,expect} from 'vitest';
import {mkdtempSync,mkdirSync,writeFileSync,readFileSync,copyFileSync,cpSync,rmSync,chmodSync,statSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {execFileSync} from 'node:child_process';
const bundle=new URL('../../deploy/company/',import.meta.url);
function fixture(run){
 const root=mkdtempSync(join(tmpdir(),'company-backup-'));
 try{
  const bin=join(root,'bin');mkdirSync(bin);
  writeFileSync(join(bin,'flock'),'#!/bin/sh\nexit 0\n',{mode:0o755});
  writeFileSync(join(bin,'docker'),`#!/bin/sh
set -eu
case "$*" in
 'compose build') test -d packages ;;
 *pg_dump*) printf 'database snapshot' ;;
 *'SELECT count('* ) printf '0\\n' ;;
esac
`,{mode:0o755});
  const env={...process.env,PATH:bin+':'+process.env.PATH};
  run(root,env);
 }finally{rmSync(root,{recursive:true,force:true});}
}
function configuration(directory,withPackage){
 mkdirSync(directory,{recursive:true});
 for(const name of ['config','secrets'])mkdirSync(join(directory,name));
 for(const name of ['.env','config/server.env','Caddyfile','dns-provider.caddy','compose.yaml','Dockerfile','Caddy.Dockerfile','caddy-entrypoint.sh'])writeFileSync(join(directory,name),'operator configuration');
 if(withPackage){cpSync(new URL('runtime-source',bundle),join(directory,'runtime-source'),{recursive:true});copyFileSync(new URL('patch-npm.mjs',bundle),join(directory,'patch-npm.mjs'));mkdirSync(join(directory,'packages'));writeFileSync(join(directory,'packages/afbin.tgz'),'exact package');}
}
it('backup includes the exact local package needed to rebuild on another host',()=>fixture((root,env)=>{
 const first=join(root,'first'),snapshot=join(root,'snapshot');configuration(first,true);
 for(const name of ['backup.sh','restore.sh'])copyFileSync(new URL(name,bundle),join(first,name));
 execFileSync('sh',['backup.sh',snapshot],{cwd:first,env});
 const unpack=join(root,'unpack');mkdirSync(unpack);
 execFileSync('tar',['-xzf',join(snapshot,'configuration.tar.gz'),'-C',unpack]);
 expect(readFileSync(join(unpack,'packages/afbin.tgz'),'utf8')).toBe('exact package');
 expect(readFileSync(join(unpack,'runtime-source/build.sh'),'utf8')).toBe(readFileSync(new URL('runtime-source/build.sh',bundle),'utf8'));
 expect(readFileSync(join(unpack,'runtime-source/tar-patches/SHA256SUMS'),'utf8')).toBe(readFileSync(new URL('runtime-source/tar-patches/SHA256SUMS',bundle),'utf8'));
 expect(readFileSync(join(unpack,'patch-npm.mjs'),'utf8')).toBe(readFileSync(new URL('patch-npm.mjs',bundle),'utf8'));
 expect(readFileSync(join(unpack,'backup.sh'),'utf8')).toBe(readFileSync(new URL('backup.sh',bundle),'utf8'));
 expect(readFileSync(join(unpack,'restore.sh'),'utf8')).toBe(readFileSync(new URL('restore.sh',bundle),'utf8'));
}));
it('older registry-backed snapshots restore with only the restore script in a fresh directory',()=>fixture((root,env)=>{
 const first=join(root,'first'),snapshot=join(root,'snapshot'),restored=join(root,'restored');configuration(first,false);
 mkdirSync(snapshot);mkdirSync(restored);
 execFileSync('tar',['-czf',join(snapshot,'configuration.tar.gz'),'.'],{cwd:first});
 for(const name of ['database.dump','artifacts.tar.gz'])writeFileSync(join(snapshot,name),'snapshot');
 copyFileSync(new URL('restore.sh',bundle),join(restored,'restore.sh'));
 execFileSync('sh',['restore.sh',snapshot],{cwd:restored,env});
 expect(readFileSync(join(restored,'config/server.env'),'utf8')).toBe('operator configuration');
}));
it('restores the archived file modes, so the rebuilt image has the build context that was backed up',()=>fixture((root,env)=>{
 const first=join(root,'first'),snapshot=join(root,'snapshot'),restored=join(root,'restored');configuration(first,true);
 for(const name of ['backup.sh','restore.sh'])copyFileSync(new URL(name,bundle),join(first,name));
 chmodSync(join(first,'packages/afbin.tgz'),0o644);chmodSync(join(first,'packages'),0o755);chmodSync(join(first,'config/server.env'),0o600);
 execFileSync('sh',['backup.sh',snapshot],{cwd:first,env});
 writeFileSync(join(snapshot,'artifacts.tar.gz'),'artifact volume (the fake docker streams none)');
 mkdirSync(restored);copyFileSync(new URL('restore.sh',bundle),join(restored,'restore.sh'));
 // Both scripts run under umask 077; without -p the package (a COPY input) came back 0600 and missed Docker's layer cache.
 execFileSync('sh',['restore.sh',snapshot],{cwd:restored,env});
 const mode=file=>statSync(file).mode&0o777;
 for(const file of ['packages/afbin.tgz','packages','config/server.env','Dockerfile','patch-npm.mjs','runtime-source/build.sh','runtime-source/tar-patches/18.patch'])expect(mode(join(restored,file)),file).toBe(mode(join(first,file)));
 expect(mode(join(restored,'config/server.env'))).toBe(0o600);
}));

it('backs up an older deployment context without a shared npm helper',()=>fixture((root,env)=>{
 const first=join(root,'first'),snapshot=join(root,'snapshot');configuration(first,false);
 for(const name of ['backup.sh','restore.sh'])copyFileSync(new URL(name,bundle),join(first,name));
 execFileSync('sh',['backup.sh',snapshot],{cwd:first,env});
 const contents=execFileSync('tar',['-tzf',join(snapshot,'configuration.tar.gz')],{encoding:'utf8'});
 expect(contents).toContain('Dockerfile');expect(contents).not.toContain('patch-npm.mjs');expect(contents).not.toContain('runtime-source');
}));

it('verifies the precreated restored app before startup and stops on verification failure',()=>fixture((root,env)=>{
 const first=join(root,'first'),snapshot=join(root,'snapshot');configuration(first,false);mkdirSync(snapshot);
 execFileSync('tar',['-czf',join(snapshot,'configuration.tar.gz'),'.'],{cwd:first});
 for(const name of ['database.dump','artifacts.tar.gz'])writeFileSync(join(snapshot,name),'snapshot');
 writeFileSync(join(root,'bin/docker'),`#!/bin/sh
set -eu
printf '%s\\n' "$*" >> "$TRACE"
case "$*" in
 *'SELECT count('* ) printf '0\\n' ;;
 'compose ps --all -q app') printf 'task-created-restored-id\\n' ;;
 'inspect task-created-restored-id') printf '[{"Id":"task-created-restored-id","Config":{"Labels":{"afbin.remediation.owner":"task-owner"}},"HostConfig":{"NanoCpus":%s,"Memory":6000000000,"MemorySwap":6000000000}}]\\n' "$NANO_CPUS" ;;
esac
`,{mode:0o755});
 const hook=new URL('../ci/verify-browser-container.mjs',import.meta.url).pathname;
 for(const hookStatus of [0,7]){
  const restored=join(root,'restored-'+hookStatus),trace=join(root,'trace-'+hookStatus);mkdirSync(restored);
  copyFileSync(new URL('restore.sh',bundle),join(restored,'restore.sh'));
  const execute=()=>execFileSync('sh',['restore.sh',snapshot],{cwd:restored,env:{...env,TRACE:trace,NANO_CPUS:hookStatus===0?'2000000000':'5000000000',RESTORE__BEFORE_START:hook,BROWSER__CONTAINER_OWNER:'task-owner',BROWSER__CPU_CAP:'2',BROWSER__OWNER_RECEIPT:join(root,'receipt-'+hookStatus+'.json')}});
  if(hookStatus===0)execute();else expect(execute).toThrow();
  const operations=readFileSync(trace,'utf8').trim().split('\n'),verification=operations.indexOf('inspect task-created-restored-id');
  expect(verification).toBeGreaterThan(operations.indexOf('compose create app'));
  if(hookStatus===0)expect(operations.indexOf('compose up -d --no-recreate')).toBeGreaterThan(verification);
  else expect(operations.some(operation=>operation==='compose up -d'||operation==='compose up -d --no-recreate')).toBe(false);
 }
}));
