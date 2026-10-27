"""Adopt independently reviewed successful READ recovery; never retry/adopt a write.

Preserve the failed command, log and manifest. A separate immutable recovery job
must have completed every replacement step and the reviewer binds both job hashes.
"""
import argparse,json,pathlib
from runner import advance,atomic,canonical,check_completed,event,job,load,output_refs,ref,require,sha,transaction

def resolve(db,request,after_receipt=lambda:None):
    require(request.get('format')=='migration-batch-reconciliation-v1'and request.get('accepted')is True and request.get('writerSafeToRelease')is True,'reconciliation_contract')
    original=request['originalJob'];recovery=request['recoveryJob']
    with transaction(db)as c:
        j,m=job(c,original);r,rm=job(c,recovery)
        require(j['hash']==request['originalJobSha256']and r['hash']==request['recoveryJobSha256']and request['reviewer']==m.get('reviewer','reviewer'),'reconciliation_binding')
        require(all(m[k]==rm[k]for k in ['owner','artifact','version','plan']),'reconciliation_identity')
        require(c.execute("SELECT 1 FROM steps WHERE job=?AND status!='complete'",(recovery,)).fetchone()is None,'recovery_incomplete');check_completed(c,recovery);check_completed(c,original)
        receipt=pathlib.Path(j['root'])/'reviewed-reconciliation.json'
        exists=receipt.exists()
        if exists:require(load(receipt)==request,'reconciliation_changed')
        pending={row['id']:row for row in c.execute("SELECT * FROM steps WHERE job=?AND status!='complete'",(original,))}
        if pending:
            require(set(pending)==set(request['steps']),'reconciliation_coverage')
            updates=[]
            for old,new in request['steps'].items():
                a=next(s for s in m['steps']if s['id']==old);b=next(s for s in rm['steps']if s['id']==new)
                require(a['kind']==b['kind']=='read','read_recovery_only')
                require(pending[old]['status']in ['exception','pending'],'reconciliation_state')
                outputs=output_refs(a);recovered=output_refs(b);require(all(f in recovered for f in outputs),'recovery_output_binding');updates.append((old,outputs))
            if not exists:atomic(receipt,request)
            after_receipt()
            recovery_receipt=pathlib.Path(r['root'])/'completion.json';require(recovery_receipt.is_file(),'recovery_completion_receipt')
            for old,outputs in updates:
                c.execute("UPDATE steps SET status='complete',outputs=?,pid=NULL WHERE job=?AND id=?",(canonical([*outputs,ref(receipt),ref(recovery_receipt)]),original,old))
                event(c,original,old,'independent_read_reconciliation',{'request':ref(receipt),'recoveryJob':recovery,'priorFailurePreserved':True})
        else:require(exists,'reconciliation_missing')
    return advance(db,original)

if __name__=='__main__':
    p=argparse.ArgumentParser(description=__doc__);p.add_argument('--db',required=True);p.add_argument('--request',required=True);p.add_argument('--sha256',required=True);a=p.parse_args();require(sha(a.request)==a.sha256,'external_binding');print(json.dumps(resolve(a.db,load(a.request))))
