import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
test("backup capacity admits multi-gigabyte schemas and refuses excess before restoring", () => {
  const result = spawnSync(
    "python3",
    [
      "-c",
      `
import importlib.util
spec=importlib.util.spec_from_file_location('backup','deploy/backup-schema.py')
m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m)
a,v=m.capacity(15*m.GIB)
assert a==31*m.GIB and v==64*m.GIB
a,v=m.capacity(8*m.GIB)
assert a==17*m.GIB and v==42*m.GIB and v>512*1024**2
for invalid in [-1, 1.5, 30*m.GIB]:
 try:m.capacity(invalid);raise AssertionError('budget must refuse')
 except RuntimeError:pass
`,
    ],
    { encoding: "utf8" },
  );
  assert.equal(result.status, 0, result.stderr);
});
test("restore monitor aborts at usage, free-space or deadline bounds and kills its process", () => {
  const result = spawnSync(
    "python3",
    [
      "-c",
      `
import importlib.util,subprocess,tempfile
from pathlib import Path
from types import SimpleNamespace
spec=importlib.util.spec_from_file_location('backup','deploy/backup-schema.py')
m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m)
for failure in ['usage','reserve','deadline']:
 class Process:
  killed=False
  def wait(self,timeout):
   if self.killed:return -9
   raise subprocess.TimeoutExpired('verifier',timeout)
  def poll(self):return -9 if self.killed else None
  def kill(self):self.killed=True
 process=Process()
 m.subprocess.Popen=lambda *a,**k:process
 m.subprocess.run=lambda *a,**k:SimpleNamespace(returncode=0,stdout=b'999999999999\\n999999999999\\n')
 m.shutil.disk_usage=lambda p:SimpleNamespace(free=0 if failure=='reserve' else 100*m.GIB)
 m.time.monotonic=lambda:1
 with tempfile.TemporaryDirectory() as folder:
  archive=Path(folder)/'dump';archive.write_bytes(b'archive')
  proof=m.VolumeProof()
  try:proof.restore(archive,4*m.GIB,Path(folder),0 if failure=='deadline' else 100);raise AssertionError('must abort')
  except RuntimeError:pass
  assert process.killed
`,
    ],
    { encoding: "utf8" },
  );
  assert.equal(result.status, 0, result.stderr);
});
test("cleanup rejects foreign ownership and refuses to delete its volume before container absence", () => {
  const result = spawnSync(
    "python3",
    [
      "-c",
      `
import importlib.util
spec=importlib.util.spec_from_file_location('backup','deploy/backup-schema.py')
m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m)
proof=m.VolumeProof();proof.containers=[proof.name];proof.volume_attempted=True
calls=[]
m.absent=lambda *a:False
m.owned=lambda *a:False
m.command=lambda *a,**k:calls.append(a)
try:proof.close();raise AssertionError('must refuse foreign container')
except RuntimeError:pass
assert not calls
m.owned=lambda *a:True
try:proof.close();raise AssertionError('must require absence')
except RuntimeError:pass
assert len(calls)==1 and calls[0][0][1]=='rm'
assert proof.volume_attempted
`,
    ],
    { encoding: "utf8" },
  );
  assert.equal(result.status, 0, result.stderr);
});
test("completed restore enforces final volume budget and host reserve", () => {
  const result = spawnSync("python3", ["-c", `
import importlib.util, subprocess, tempfile
from pathlib import Path
from types import SimpleNamespace
spec=importlib.util.spec_from_file_location('backup','deploy/backup-schema.py')
m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m)
real_run=subprocess.run
real_popen=subprocess.Popen
for used,free,host,expected in [(5,100,100,False),(1,1,100,False),(1,100,0,False),(1,100,100,True)]:
 class Process:
  def wait(self,timeout):return self.code
  def poll(self):return self.code
 def start(args,**kwargs):
  script=args[-4].split('used=$(du',1)[1]
  script='used=$(du'+script
  prefix='du() { echo "'+str(used*m.GIB//1024)+' /proof"; }; df() { printf "header\\nfs 1 1 '+str(free*m.GIB//1024)+' /proof\\n"; }; '
  m.subprocess.Popen=real_popen
  code=real_run(['sh','-c',prefix+script,*args[-3:]],stdout=subprocess.DEVNULL,stderr=subprocess.PIPE).returncode
  m.subprocess.Popen=start
  process=Process();process.code=code;return process
 m.subprocess.Popen=start
 m.shutil.disk_usage=lambda p:SimpleNamespace(free=host*m.GIB)
 with tempfile.TemporaryDirectory() as folder:
  archive=Path(folder)/'dump';archive.write_bytes(b'archive')
  passed=False
  try:m.VolumeProof().restore(archive,4*m.GIB,Path(folder),m.time.monotonic()+10);passed=True
  except RuntimeError:pass
  assert passed==expected,(used,free,host,passed)
`], { encoding: "utf8" });
  assert.equal(result.status, 0, result.stderr);
});
test("restore admission uses actual archive and available space while retaining its reserve", () => {
  const result = spawnSync("python3", ["-c", `
import importlib.util
spec=importlib.util.spec_from_file_location('backup','deploy/backup-schema.py')
m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m)
# A 15GiB source with a measured 4GiB archive can prove recovery on 50GiB free.
assert m.restore_capacity(15*m.GIB,4*m.GIB,50*m.GIB)==42*m.GIB
assert m.restore_capacity(15*m.GIB,4*m.GIB,100*m.GIB)==50*m.GIB
# The archive is copied into the restore volume; source+copy+1GiB must fit.
for archive,free in [(4,27),(20,43)]:
 try:m.restore_capacity(15*m.GIB,archive*m.GIB,free*m.GIB);raise AssertionError('must refuse')
 except RuntimeError:pass
`], { encoding: "utf8" });
  assert.equal(result.status, 0, result.stderr);
});
test("dump aborts and terminates when concurrent disk use reaches reserve or deadline", () => {
  const result = spawnSync("python3", ["-c", `
import importlib.util,subprocess
from types import SimpleNamespace
spec=importlib.util.spec_from_file_location('backup','deploy/backup-schema.py')
m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m)
for failure in ['reserve','deadline','exit']:
 class Process:
  killed=False
  def poll(self):return -9 if self.killed else None
  def kill(self):self.killed=True
  def wait(self,timeout):
   if self.killed:return -9
   if failure=='exit':return 1
   raise subprocess.TimeoutExpired('dump',timeout)
 process=Process();m.subprocess.Popen=lambda *a,**k:process
 frees=iter([10*m.GIB,0]);m.shutil.disk_usage=lambda p:SimpleNamespace(free=next(frees))
 m.time.monotonic=lambda:1
 try:m.dump_archive({},None,m.GIB,'.',0 if failure=='deadline' else 100);raise AssertionError('must refuse')
 except RuntimeError:pass
 assert process.killed
`], { encoding: "utf8" });
  assert.equal(result.status, 0, result.stderr);
});
test("backup measures archive before admission and leaves no receipt when either stage refuses", () => {
  const result = spawnSync("python3", ["-c", `
import importlib.util,tempfile
from pathlib import Path
from types import SimpleNamespace
spec=importlib.util.spec_from_file_location('backup','deploy/backup-schema.py')
m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m)
m.configuration=lambda p:{}
m.capture=lambda args,**kw:b'pg_dump (PostgreSQL) 18.6' if args[0]=='pg_dump' else str(15*m.GIB).encode()
for stage in ['before','archive-cap','after','restore','success']:
 calls=[]
 class Proof:
  def create(self):calls.append('create');return 60*m.GIB
  def measure_bytes(self,usage=False):return 16*m.GIB if usage else (10 if stage=='after' else 50)*m.GIB
  def restore(self,*args):
   calls.append('restore')
   if stage=='restore':raise RuntimeError('restore failed')
  def close(self):calls.append('close')
 m.VolumeProof=Proof
 m.shutil.disk_usage=lambda p:SimpleNamespace(free=(0 if stage=='before' else 58*m.GIB))
 def dump(env,out,limit,directory,deadline):
  calls.append('dump')
  assert limit==31*m.GIB
  if stage=='archive-cap':raise RuntimeError('archive exceeds limit')
  out.write(b'x'*1024)
 m.dump_archive=dump
 with tempfile.TemporaryDirectory() as folder:
  output=Path(folder)/'backup.dump'
  passed=False
  try:m.backup(Path(folder)/'config',output);passed=True
  except RuntimeError:pass
  assert passed==(stage=='success'),stage
  assert output.exists()==passed
  assert output.with_name(output.name+'.verified').exists()==passed
  assert not output.with_name(output.name+'.tmp').exists()
  if stage=='success':
   import json
   receipt=json.loads(output.with_name(output.name+'.verified').read_text())
   assert receipt['archiveBytes']==1024 and receipt['restoredBytes']==16*m.GIB
   assert receipt['restoreVolumeLimit']==42*m.GIB
  if stage=='before':assert not calls
  else:assert 'close' in calls
  if stage=='after':assert 'restore' not in calls
`], { encoding: "utf8" });
  assert.equal(result.status, 0, result.stderr);
});
