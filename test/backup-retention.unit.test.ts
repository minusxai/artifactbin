import {test} from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
test('backup retention only selects timestamp-owned files and protects recovery points under byte/count pressure',()=>{
 const result=spawnSync('python3',['-c',`
import importlib.util,sys
sys.dont_write_bytecode=True
spec=importlib.util.spec_from_file_location('retention','deploy/backup-retention.py')
m=importlib.util.module_from_spec(spec);sys.modules[spec.name]=m;spec.loader.exec_module(m)
B=m.Backup
name=lambda n: str(1700000000000000000+n)+'.dump'
rows=[B(name(n),10,n) for n in range(10)]
assert m.plan_retention(rows).delete == tuple(name(n) for n in range(3))
assert m.plan_retention(rows,max_bytes=0).delete == tuple(name(n) for n in range(8))
protected=[B(name(n),10,n,protected=n==0,verified=n in (1,2)) for n in range(10)]
p=m.plan_retention(protected,max_bytes=0)
assert p.delete == tuple(name(n) for n in range(3,8))
assert p.over_budget and p.remaining_bytes==50
foreign=[B('preimport.dump',500,100),B('manual.dump',500,100),B('123.dump',500,100),B(name(20),500,20,regular=False)]
p=m.plan_retention(rows+foreign,max_bytes=0)
assert p.delete == tuple(name(n) for n in range(8))
assert p.remaining_bytes==1520 and p.over_budget
assert not m.plan_retention([],max_bytes=0).over_budget
for keep,budget in [(1,0),(2,-1)]:
 try: m.plan_retention([],keep,budget)
 except ValueError: pass
 else: raise AssertionError('invalid policy accepted')
`],{encoding:'utf8'});
 assert.equal(result.status,0,result.stderr);
});
