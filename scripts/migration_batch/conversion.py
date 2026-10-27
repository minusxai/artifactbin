"""Fan out a reserved conversion batch through the existing durable command runner.

The trusted adapter snapshots/prepares/converts locally. It cannot claim artifact
acceptance. Existing per-head source/functional review and live freshness remain.
"""
import argparse,fcntl,json,pathlib,time
from runner import atomic,load,ref,verify,require,digest,enroll,advance,transaction

def accepted_ids(reference):
    found=set();seen=set();cursor=reference
    while cursor:
        verify(cursor,'accepted_chain_changed');require(cursor['path']not in seen,'accepted_cycle');seen.add(cursor['path']);v=load(cursor['path'])
        for id in v.get('sourceIds',[]):found.add(id)
        for name in ['additional','newHeads','added','heads','acceptedHeads']:
            rows=v.get(name,[]);rows=rows if isinstance(rows,list)else[rows]
            for row in rows:
                if isinstance(row,str):found.add(row)
                elif isinstance(row,dict):
                    id=row.get('sourceId')or row.get('key',{}).get('sourceId')
                    if id:found.add(id)
        cursor=v.get('prior')or v.get('previous')or v.get('previousProof')
        require(cursor is None or isinstance(cursor,dict),'accepted_prior_binding')
    return found

def prepare(config,root,only=None):
    require(config.get('format')=='migration-conversion-batch-v1','conversion_contract')
    for f in [config['plan'],config['reservation'],config['acceptedRoot'],*config['adapter']]:verify(f)
    reservation=load(config['reservation']['path']);require(reservation.get('conversionExecutor')==config['owner'],'reservation_owner')
    reserved={(a['key']['sourceId'],a['key']['version'])for a in reservation['artifacts']}
    accepted=accepted_ids(config['acceptedRoot']);items=config['items'];require(0<len(items)<=100,'batch_bound')
    require(len({i['artifact']for i in items})==len(items),'duplicate_artifact')
    if only:require(set(only)<={i['artifact']for i in items},'unknown_target')
    root=pathlib.Path(root);root.mkdir(parents=True,exist_ok=True);out=[]
    for item in items:
        if only and item['artifact']not in only:continue
        require((item['artifact'],item['version'])in reserved,'outside_reservation')
        if item['artifact']in accepted:continue
        for f in item['inputs']:verify(f)
        identity=digest({'item':item,'adapter':config['adapter'],'plan':config['plan'],'reservation':config['reservation']})[:20]
        id='convert-'+item['artifact']+'-'+identity
        manifest={'format':'migration-batch-job-v1','id':id,'owner':config['owner'],'artifact':item['artifact'],'version':item['version'],'scope':'latest','reviewer':'independent-content-review','plan':config['plan'],'steps':[{'id':'local-conversion','kind':'read','inputs':[config['reservation'],*config['adapter'],*item['inputs']],'command':item['command'],'cwd':item['cwd'],'outputs':[{'path':item['output'],'assertions':[{'path':'productionWrites','equals':0},{'path':'acceptanceClaimed','equals':False}]}]}]}
        p=root/(id+'.json')
        if p.exists():require(load(p)==manifest,'conversion_manifest_changed')
        else:atomic(p,manifest)
        out.append((item,p,id))
    return out

def run(config,root,db,only=None):
    root=pathlib.Path(root);root.mkdir(parents=True,exist_ok=True)
    # One controller per shared batch; detached workers remain owned by runner DB.
    with pathlib.Path(db).with_name('conversion-controller.lock').open('a')as lock:
        fcntl.flock(lock,fcntl.LOCK_EX|fcntl.LOCK_NB)
        selected=prepare(config,root/'manifests',only)
        for item,p,id in selected:
            with transaction(db)as c:
                for old in c.execute("SELECT id,manifest FROM jobs WHERE id LIKE 'convert-%'"):
                    m=load(old['manifest'])
                    if m['artifact']==item['artifact']and old['id']!=id:
                        unfinished=c.execute("SELECT 1 FROM steps WHERE job=?AND status IN ('running','pending')",(old['id'],)).fetchone()
                        require(not unfinished,'duplicate_conversion_generation')
            enroll(db,p)
        while True:
            states={};active=0
            for _,_,id in selected:
                with transaction(db)as c:
                    current=c.execute('SELECT status FROM steps WHERE job=?',(id,)).fetchone()['status']
                if current=='pending'and active>=2:states[id]={'status':'ready'};continue
                states[id]=advance(db,id)
                if states[id]['status']=='running':active+=1
            if not any(v['status']in ['running','ready']for v in states.values()):break
            time.sleep(.25)
        rows=[];groups={}
        for item,_,id in selected:
            s=states[id];row={'artifact':item['artifact'],'version':item['version'],'job':id,'orchestration':s['status']}
            if s['status']=='complete':
                packet=load(item['output']);row.update(status=packet['status'],packet=ref(item['output']),codes=packet.get('codes',[]))
            else:row.update(status='exception',codes=[s.get('reason','orchestration_exception')])
            for code in row.get('codes',[]):groups.setdefault(code,[]).append(item['artifact'])
            rows.append(row)
        previous=load(root/'summary.json').get('rows',[])if(root/'summary.json').exists()else[]
        merged={r['artifact']:r for r in previous};merged.update({r['artifact']:r for r in rows});rows=list(merged.values());groups={}
        for row in rows:
            for code in row.get('codes',[]):groups.setdefault(code,[]).append(row['artifact'])
        value={'format':'migration-conversion-batch-result-v1','thisRunAttempted':len(selected),'attempted':len(rows),'converted':sum(r.get('status')=='converted'for r in rows),'exceptions':sum(r.get('status')!='converted'for r in rows),'rows':rows,'exceptionGroups':groups,'productionWrites':0,'acceptanceClaimed':False}
        atomic(root/'summary.json',value);return value

if __name__=='__main__':
    p=argparse.ArgumentParser(description=__doc__);p.add_argument('--config',required=True);p.add_argument('--sha256',required=True);p.add_argument('--root',required=True);p.add_argument('--db',required=True);p.add_argument('--only',nargs='+');a=p.parse_args();verify({'path':a.config,'sha256':a.sha256});print(json.dumps(run(load(a.config),a.root,a.db,a.only)))
