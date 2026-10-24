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
