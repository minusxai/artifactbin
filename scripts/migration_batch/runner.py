#!/usr/bin/env python3
"""Durable POSIX host wrapper for existing migration commands, not an importer.

Only explicit coordinator grants reserve shared resources. Never infer a free
lease from process listings, expiry, or an interrupted network connection.
"""
import argparse,contextlib,hashlib,json,os,pathlib,re,sqlite3,subprocess,sys,time,threading
os.umask(0o077)

def sha(path):return hashlib.sha256(pathlib.Path(path).read_bytes()).hexdigest()
def canonical(value):return json.dumps(value,sort_keys=True,separators=(',',':'))
def digest(value):return hashlib.sha256(canonical(value).encode()).hexdigest()
def load(path):return json.loads(pathlib.Path(path).read_text())
def require(ok,code):
    if not ok:raise ValueError(code)
def ref(path):return {'path':str(path),'sha256':sha(path)}
def verify(reference,code='input_changed'):
    p=pathlib.Path(reference['path']);require(p.is_file()and not p.is_symlink()and sha(p)==reference['sha256'],code)
def atomic(path,value):
    p=pathlib.Path(path);tmp=p.with_name(p.name+'.tmp-'+str(os.getpid()));p.parent.mkdir(parents=True,exist_ok=True)
    with tmp.open('x')as f:f.write(json.dumps(value,indent=2)+'\n');f.flush();os.fsync(f.fileno())
    os.replace(tmp,p)
    fd=os.open(p.parent,os.O_RDONLY)
    try:os.fsync(fd)
    finally:os.close(fd)

@contextlib.contextmanager
def transaction(db):
    db=pathlib.Path(db).resolve();db.parent.mkdir(parents=True,exist_ok=True)
    c=sqlite3.connect(db,timeout=15,isolation_level=None);c.row_factory=sqlite3.Row
    c.execute('PRAGMA journal_mode=WAL');c.execute('PRAGMA synchronous=FULL');c.execute('PRAGMA foreign_keys=ON')
    c.executescript('CREATE TABLE IF NOT EXISTS jobs(id TEXT PRIMARY KEY, hash TEXT NOT NULL, manifest TEXT NOT NULL, root TEXT NOT NULL, engine TEXT NOT NULL);CREATE TABLE IF NOT EXISTS steps(job TEXT, id TEXT, ordinal INTEGER, status TEXT NOT NULL, attempts INTEGER DEFAULT 0, pid INTEGER, started REAL, detail TEXT, outputs TEXT, PRIMARY KEY(job,id));CREATE TABLE IF NOT EXISTS resources(resource TEXT PRIMARY KEY, job TEXT NOT NULL, step TEXT NOT NULL, grant_json TEXT NOT NULL, active INTEGER DEFAULT 0);CREATE TABLE IF NOT EXISTS events(seq INTEGER PRIMARY KEY, at REAL, job TEXT, step TEXT, event TEXT, detail TEXT);')
    try:
        c.execute('BEGIN IMMEDIATE');yield c;c.execute('COMMIT')
    except BaseException:
        if c.in_transaction:c.execute('ROLLBACK')
        raise
    finally:c.close()
def event(c,job,step,name,detail=None):c.execute('INSERT INTO events(at,job,step,event,detail)VALUES(?,?,?,?,?)',(time.time(),job,step,name,canonical(detail)))
def job(c,id):
    row=c.execute('SELECT * FROM jobs WHERE id=?',(id,)).fetchone();require(row is not None,'unknown_job')
    for f in json.loads(row['engine']):verify(f,'engine_changed')
    return row,load(row['manifest'])
def validate(manifest):
    require(manifest.get('format')=='migration-batch-job-v1'and manifest.get('scope')=='latest','latest_scope')
    verify(manifest['plan']);plan=load(manifest['plan']['path']);heads=plan.get('heads',[])
    require(plan.get('revisionScope')=='latest'and len(heads)==393,'latest_scope')
    require(any(h.get('key',{}).get('sourceId')==manifest['artifact']and h['key'].get('version')==manifest['version']for h in heads),'plan_membership')
    require(manifest.get('id')and manifest.get('owner')and manifest.get('steps'),'job_contract')
    ids=set()
    for step in manifest['steps']:
        require(re.fullmatch(r'[A-Za-z0-9][A-Za-z0-9_-]{0,79}',step['id'])and step['id']not in ids and step['kind']in ['read','browser','write','review'],'step_contract');ids.add(step['id'])
        require(1<=step.get('maxAttempts',1)<=3,'retry_bound')
        if step['kind']!='review':require(bool(step.get('command'))and pathlib.Path(step['cwd']).is_dir()and bool(step['outputs']),'command_contract')
        if step['kind']in ['browser','write']:require(step.get('maxAttempts',1)==1,'no_mutating_retry')
        if step['kind']=='write':require(bool(step.get('approval')),'write_approval_required');verify(step['approval'],'approval_changed')
        for f in step['inputs']:verify(f)
    return manifest
def enroll(db,manifest_path):
    manifest_path=pathlib.Path(manifest_path).resolve();m=validate(load(manifest_path));h=sha(manifest_path)
    with transaction(db)as c:
        old=c.execute('SELECT hash FROM jobs WHERE id=?',(m['id'],)).fetchone()
        if old:require(old['hash']==h,'job_changed');return {'id':m['id'],'sha256':h,'existing':True}
        root=pathlib.Path(db).resolve().parent/'jobs'/digest(m['id'])[:24];root.mkdir(parents=True,exist_ok=True);copy=root/'manifest.json'
        # Preserve the actual bytes: external approval binds this exact file hash.
        if copy.exists():require(sha(copy)==h,'enrollment_manifest_collision')
        else:
            with copy.open('xb')as f:f.write(manifest_path.read_bytes());f.flush();os.fsync(f.fileno())
        engine=[ref(pathlib.Path(__file__).with_name(name))for name in ['runner.py','contract.py','completion.py','verify.py']]
        c.execute('INSERT INTO jobs VALUES(?,?,?,?,?)',(m['id'],h,str(copy),str(root),canonical(engine)))
        for i,s in enumerate(m['steps']):c.execute('INSERT INTO steps(job,id,ordinal,status)VALUES(?,?,?,?)',(m['id'],s['id'],i,'pending'))
        event(c,m['id'],None,'enrolled',{'sha256':h})
    return {'id':m['id'],'sha256':h,'existing':False}
def output_refs(step):
    refs=[]
    for out in step['outputs']:
        p=pathlib.Path(out['path']);require(p.is_file()and not p.is_symlink(),'missing_output')
        if out.get('assertions'):
            value=load(p)
            for assertion in out['assertions']:
                selected=value
                for key in assertion['path'].split('.'):
                    selected=selected[int(key)]if isinstance(selected,list)else selected[key]
                require(type(selected)is type(assertion['equals'])and selected==assertion['equals'],'output_assertion')
        refs.append(ref(p))
    return refs
def check_completed(c,id):
    for s in c.execute("SELECT outputs FROM steps WHERE job=? AND status='complete'",(id,)):
        for f in json.loads(s['outputs']or'[]'):verify(f,'output_changed')
def resources(db):
    with transaction(db)as c:return [dict(r)for r in c.execute('SELECT resource,job,step,active FROM resources ORDER BY resource')]
def grant(db,g):
    require(g.get('format')=='migration-batch-grant-v1'and bool(g.get('coordinator')),'grant_contract');require(g['expiresAt']>time.time(),'grant_expired')
    require(g['resource']in ['browser-1','browser-2','writer'],'grant_resource')
    with transaction(db)as c:
        row=c.execute('SELECT id FROM jobs WHERE hash=?',(g['jobSha256'],)).fetchone();require(row is not None,'grant_binding');j,m=job(c,row['id']);s=next((s for s in m['steps']if s['id']==g['step']),None)
        require(m['owner']==g['owner']and s is not None and ((s['kind']=='write'and g['resource']=='writer')or(s['kind']=='browser'and g['resource'].startswith('browser-'))),'grant_binding')
        require(c.execute('SELECT 1 FROM resources WHERE resource=?',(g['resource'],)).fetchone()is None,'resource_busy')
        require(c.execute('SELECT 1 FROM resources WHERE job=? AND step=?',(m['id'],s['id'])).fetchone()is None,'step_already_reserved')
        c.execute('INSERT INTO resources VALUES(?,?,?,?,0)',(g['resource'],m['id'],s['id'],canonical(g)));event(c,m['id'],s['id'],'grant',g)
    return {'reserved':g['resource']}
def alive(pid):
    if not pid:return False
    # waitpid handles our own dead detached child without treating a zombie as live.
    try:
        result,_=os.waitpid(pid,os.WNOHANG)
        if result:return False
    except ChildProcessError:pass
    try:os.kill(pid,0);return True
    except ProcessLookupError:return False
def packet(c,j,m,s):
    stages=[{'id':r['id'],'outputs':json.loads(r['outputs']or'[]')}for r in c.execute("SELECT * FROM steps WHERE job=?AND status='complete'ORDER BY ordinal",(m['id'],))]
    value={'format':'migration-batch-packet-v1','jobSha256':j['hash'],'engine':json.loads(j['engine']),'job':m['id'],'owner':m['owner'],'artifact':m['artifact'],'version':m['version'],'step':s['id'],'plan':m['plan'],'stages':stages}
    p=pathlib.Path(j['root'])/(s['id']+'.review-packet.json')
    if p.exists():require(load(p)==value,'packet_changed')
    else:atomic(p,value)
    return p
def approve(db,id,review):
    with transaction(db)as c:
        j,m=job(c,id);check_completed(c,id);s=next((s for s in m['steps']if s['id']==review.get('step')),None)
        require(s is not None and s['kind']=='review','review_binding');p=packet(c,j,m,s)
        first=c.execute("SELECT id FROM steps WHERE job=?AND status!='complete'ORDER BY ordinal LIMIT 1",(id,)).fetchone()
        require(first is None or first['id']==s['id'],'review_predecessor')
        require(review.get('format')=='migration-batch-review-v1'and review.get('accepted')is True and review.get('reviewer')==m.get('reviewer','reviewer')and review.get('jobSha256')==j['hash']and review.get('packetSha256')==sha(p),'review_binding')
        row=c.execute('SELECT status FROM steps WHERE job=? AND id=?',(id,s['id'])).fetchone();require(row['status']in ['pending','waiting_review','complete'],'review_state')
        out=pathlib.Path(j['root'])/(s['id']+'.approval.json')
        if out.exists():require(load(out)==review,'review_changed')
        else:atomic(out,review)
        c.execute("UPDATE steps SET status='complete',outputs=? WHERE job=?AND id=?",(canonical([ref(p),ref(out)]),id,s['id']));event(c,id,s['id'],'approved',review)
    return {'approved':s['id']}
def advance(db,id):
    with transaction(db)as c:
        j,m=job(c,id);require(sha(j['manifest'])==j['hash'],'job_changed');validate(m);check_completed(c,id)
        row=c.execute("SELECT * FROM steps WHERE job=?AND status!='complete'ORDER BY ordinal LIMIT 1",(id,)).fetchone()
        if row is None:
            receipt=pathlib.Path(j['root'])/'completion.json'
            value={'format':'migration-batch-completion-v1','jobSha256':j['hash'],'artifact':m['artifact'],'version':m['version'],'stages':[dict(r)for r in c.execute('SELECT id,attempts,outputs FROM steps WHERE job=?ORDER BY ordinal',(id,))]}
            if receipt.exists():require(load(receipt)==value,'completion_receipt_changed')
            else:atomic(receipt,value)
            c.execute('DELETE FROM resources WHERE job=?',(id,));return {'status':'complete','receipt':str(receipt)}
        s=m['steps'][row['ordinal']]
        if row['status']=='exception':return {'status':'exception','step':s['id'],'reason':row['detail']}
        if row['status']=='running':
            if row['pid']and not alive(row['pid']):
                c.execute("UPDATE steps SET status='exception',detail='worker_lost_reconciliation_required'WHERE job=?AND id=?",(id,s['id']));event(c,id,s['id'],'exception','worker_lost_reconciliation_required');return {'status':'exception','step':s['id'],'reason':'worker_lost_reconciliation_required'}
            return {'status':'running','step':s['id'],'pid':row['pid']}
        if s['kind']=='review':
            p=packet(c,j,m,s);c.execute("UPDATE steps SET status='waiting_review'WHERE job=?AND id=?",(id,s['id']));return {'status':'waiting_review','step':s['id'],'packet':str(p),'sha256':sha(p)}
        if s.get('approval'):verify(s['approval'],'approval_changed')
        if s['kind']in ['browser','write']:
            lease=c.execute('SELECT * FROM resources WHERE job=? AND resource=?',(id,'writer')).fetchone()if s['kind']=='write'else c.execute('SELECT * FROM resources WHERE job=? AND step=?',(id,s['id'])).fetchone()
            if lease is None:return {'status':'waiting_lease','step':s['id'],'resource':s['kind']}
            require(lease['active']or load_grant(lease)['expiresAt']>time.time(),'grant_expired')
            c.execute('UPDATE resources SET active=1 WHERE resource=?',(lease['resource'],))
        attempt=row['attempts']+1;log=pathlib.Path(j['root'])/(s['id']+f'.attempt-{attempt}.log')
        c.execute("UPDATE steps SET status='running',attempts=?,pid=NULL,started=?WHERE job=?AND id=?",(attempt,time.time(),id,s['id']));event(c,id,s['id'],'launch',{'attempt':attempt})
        with log.open('xb')as output:
            child=subprocess.Popen([sys.executable,str(pathlib.Path(__file__).resolve()),'worker','--db',str(pathlib.Path(db).resolve()),'--job',id,'--step',s['id'],'--attempt',str(attempt)],stdout=output,stderr=subprocess.STDOUT,start_new_session=True)
        # Reap while this controller lives; detached worker remains independent on controller exit.
        threading.Thread(target=child.wait,daemon=True).start()
        c.execute('UPDATE steps SET pid=?WHERE job=?AND id=?',(child.pid,id,s['id']))
        return {'status':'running','step':s['id'],'pid':child.pid}
def load_grant(row):return json.loads(row['grant_json'])
def worker(db,id,step,attempt):
    with transaction(db)as c:
        j,m=job(c,id);s=next(s for s in m['steps']if s['id']==step);row=c.execute('SELECT * FROM steps WHERE job=?AND id=?',(id,step)).fetchone();require(row['status']=='running'and row['attempts']==attempt and row['pid']==os.getpid(),'worker_claim');validate(m);check_completed(c,id)
    try:
        result=subprocess.run(s['command'],cwd=s['cwd'],stdin=subprocess.DEVNULL,check=False)
        require(result.returncode==0,'command_exit_'+str(result.returncode));outputs=output_refs(s);status='complete';detail=None
    except Exception as e:
        outputs=[];detail=str(e);retry=s['kind']=='read'and detail in ['command_exit_'+str(code)for code in s.get('retryExitCodes',[])]and attempt<s.get('maxAttempts',1);status='pending'if retry else'exception'
    with transaction(db)as c:
        c.execute('UPDATE steps SET status=?,detail=?,outputs=?,pid=NULL WHERE job=?AND id=?AND attempts=?',(status,detail,canonical(outputs),id,step,attempt));event(c,id,step,status,detail)
        # Writer spans apply + complete preservation readback/recording; never free on uncertainty.
        if s['kind']=='browser'and status=='complete':c.execute('DELETE FROM resources WHERE job=?AND step=?',(id,step))

def main():
    p=argparse.ArgumentParser(description=__doc__);p.add_argument('action',choices=['enroll','advance','watch','batch','status','grant','approve','worker']);p.add_argument('--db',required=True);p.add_argument('--job');p.add_argument('--owner');p.add_argument('--manifest');p.add_argument('--file');p.add_argument('--sha256');p.add_argument('--step');p.add_argument('--attempt',type=int);a=p.parse_args()
    if a.action=='worker':worker(a.db,a.job,a.step,a.attempt);return
    if a.action in ['grant','approve']:require(a.file and a.sha256 and sha(a.file)==a.sha256,'external_binding')
    if a.action=='enroll':result=enroll(a.db,a.manifest)
    elif a.action=='grant':result=grant(a.db,load(a.file))
    elif a.action=='approve':result=approve(a.db,a.job,load(a.file))
    elif a.action=='batch':
        require(bool(a.owner),'owner_required')
        while True:
            with transaction(a.db)as c:ids=[r['id']for r in c.execute('SELECT * FROM jobs ORDER BY id')if load(r['manifest'])['owner']==a.owner]
            result={'owner':a.owner,'jobs':{}}
            for id in ids:
                try:result['jobs'][id]=advance(a.db,id)
                except Exception as e:result['jobs'][id]={'status':'exception','reason':str(e)}
            if not any(s['status']=='running'for s in result['jobs'].values()):break
            time.sleep(.25)
    elif a.action=='status':
        with transaction(a.db)as c:result={'steps':[dict(r)for r in c.execute('SELECT * FROM steps WHERE job=?ORDER BY ordinal',(a.job,))],'resources':[dict(r)for r in c.execute('SELECT resource,job,step,active FROM resources')],'exceptions':[dict(r)for r in c.execute("SELECT job,id,detail FROM steps WHERE status='exception'")]}
    else:
        while True:
            result=advance(a.db,a.job)
            if a.action!='watch'or result['status']not in ['running','ready']:break
            time.sleep(.25)
    print(json.dumps(result))
    if result.get('status')=='exception'or any(s.get('status')=='exception'for s in result.get('jobs',{}).values()):sys.exit(2)

if __name__=='__main__':main()
