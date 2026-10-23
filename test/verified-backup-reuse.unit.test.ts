import {test} from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
test('verified backup reuse binds revisions, destination, restore proof, schema closure, ownership and freshness',()=>{
 const result=spawnSync('python3',['-c',String.raw`
import importlib.util,sys,tempfile,json,os,time
from pathlib import Path
sys.dont_write_bytecode=True
spec=importlib.util.spec_from_file_location('reuse','deploy/verified-backup-reuse.py')
m=importlib.util.module_from_spec(spec);sys.modules[spec.name]=m;spec.loader.exec_module(m)
with tempfile.TemporaryDirectory() as directory:
 root=Path(directory); old='a'*40; new='b'*40; now=int(time.time()); uid=os.geteuid()
 def write(path,value):
  path.parent.mkdir(parents=True,exist_ok=True);path.write_text(value);path.chmod(0o600)
 for name in m.SCHEMA_FILES:
  write(root/'releases'/old/name,'same');write(root/'releases'/new/name,'same')
 write(root/'.env.backup','PGHOST=db.invalid\nPGDATABASE=app\nPGUSER=backup\nPGSSLMODE=verify-full\n')
 write(root/'.env.production','PAGEGI_DATABASE_URL=postgresql://app:secret@db.invalid/app\n')
 archive=root/'backups'/'1700000000000000000.dump';write(archive,'restorable archive')
 marker=Path(str(archive)+'.verified');write(marker,json.dumps({'verification':'offline restore completed','archiveBytes':archive.stat().st_size}))
 approval=dict(schemaVersion=1,currentRevision=old,targetRevision=new,backupName=archive.name,archiveSha256=m.digest(archive),markerSha256=m.digest(marker),destinationSha256=m.destination_identity(root,uid),productionConfigurationSha256=m.digest(root/'.env.production'),verifiedAt=now,expiresAt=now+900,acknowledgeRecoveryPointAtBackupTime=True,reviewedCodeOnlyChange=True)
 def check(patch=None,**kwargs):
  write(root/'reuse-backup.json',json.dumps(approval | (patch or {})))
  return m.validate_reuse(root,new,old,now=now,uid=uid,**kwargs)
 def refused(patch=None):
  try:check(patch)
  except (ValueError,KeyError,FileNotFoundError):return
  raise AssertionError('unsafe approval accepted')
 assert check()==archive
 for patch in [{'currentRevision':'c'*40},{'targetRevision':'c'*40},{'archiveSha256':'0'*64},{'markerSha256':'0'*64},{'destinationSha256':'0'*64},{'productionConfigurationSha256':'0'*64},{'verifiedAt':now-7200,'expiresAt':now+1},{'expiresAt':now-1},{'expiresAt':now+3601},{'reviewedCodeOnlyChange':False},{'acknowledgeRecoveryPointAtBackupTime':False},{'backupName':'../elsewhere'},{'extra':True}]:refused(patch)
 write(root/'releases'/new/'src/schema.sql','changed');refused();write(root/'releases'/new/'src/schema.sql','same')
 write(root/'.env.production','PAGEGI_DATABASE_URL=postgresql://app:secret@other.invalid/app\n');refused();write(root/'.env.production','PAGEGI_DATABASE_URL=postgresql://app:secret@db.invalid/app\n')
 write(archive,'tampered');refused();write(archive,'restorable archive')
 marker.chmod(0o644);refused();marker.chmod(0o600)
 os.utime(marker,(now-7200,now-7200));refused();os.utime(marker,(now,now))
 check();(root/'reuse-backup.json').chmod(0o644)
 try:m.validate_reuse(root,new,old,now=now,uid=uid)
 except ValueError:pass
 else:raise AssertionError('public approval accepted')
 check();archive.rename(root/'backups'/'saved');archive.symlink_to('saved');refused()
 archive.unlink();(root/'backups'/'saved').rename(archive)
 check();m.consume_reuse(root,new,old,now=now,uid=uid)
 assert not (root/'reuse-backup.json').exists()
 assert Path(str(archive)+'.protected').is_file()
 assert Path(str(archive)+'.protected').stat().st_mode & 0o077 == 0
 try:m.consume_reuse(root,new,old,now=now,uid=uid)
 except FileNotFoundError:pass
 else:raise AssertionError('approval reused twice')
`],{encoding:'utf8'});
 assert.equal(result.status,0,result.stderr);
});

import {mkdtempSync,readFileSync,writeFileSync,mkdirSync,chmodSync,rmSync,existsSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
for(const approval of ['absent','accepted','refused']) test(`receiver backup boundary ${approval}`,()=>{
 const directory=mkdtempSync(join(tmpdir(),'backup-reuse-'));
 try{
  const bin=join(directory,'bin'),root=join(directory,'root');mkdirSync(bin);mkdirSync(root);
  if(approval!=='absent')writeFileSync(join(root,'reuse-backup.json'),'private approval');
  const log=join(directory,'calls');
  writeFileSync(join(bin,'python3'),`#!/bin/sh\nprintf '%s\\n' "$1" >> "$CALL_LOG"\nif [ "$REFUSE_REUSE" = 1 ]; then exit 19; fi\n`);chmodSync(join(bin,'python3'),0o755);
  const receiver=readFileSync('deploy/receive-artefactv2.sh','utf8');
  const block=receiver.slice(receiver.indexOf('if [[ -e "$root/reuse-backup.json"'),receiver.indexOf('export PAGEGI_IMAGE="$image"'));
  const result=spawnSync('bash',['-c',`set -euo pipefail\nroot="$FIXTURE_ROOT"\nrelease="$FIXTURE_ROOT/release"\nrevision=${'b'.repeat(40)}\nprevious=artefactv2:${'a'.repeat(40)}\n${block}\ntouch "$FIXTURE_ROOT/continued"`],{encoding:'utf8',env:{...process.env,PATH:`${bin}:${process.env.PATH}`,FIXTURE_ROOT:root,CALL_LOG:log,REFUSE_REUSE:approval==='refused'?'1':'0'}});
  const calls=readFileSync(log,'utf8').trim().split('\n');assert.equal(calls.length,1);
  assert.ok(calls[0]!.endsWith(approval==='absent'?'/backup-schema.py':'/verified-backup-reuse.py'));
  assert.equal(result.status,approval==='refused'?19:0,result.stderr);
  assert.equal(existsSync(join(root,'continued')),approval!=='refused');
 }finally{rmSync(directory,{recursive:true,force:true});}
});
