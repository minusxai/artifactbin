"""Restart-safe completion receipt and ACTIVE promotion, using normal full-reader proof.

No acceptance is inferred from apply. A receipt survives process loss between
receipt creation and alias promotion; a later invocation validates and promotes
that exact receipt without another import, token mint, or count increment.
"""
import argparse,contextlib,datetime,fcntl,json,pathlib
from runner import atomic,load,ref as file_ref,require,verify

def ref(path):return {**file_ref(path),'bytes':pathlib.Path(path).stat().st_size}

def prepare(source,version,queue,active):
    a=load(active);p=pathlib.Path(a['latestCompletionReceipt']);prior=ref(p);require(prior['sha256']==a['latestCompletionReceiptSha256'],'active_chain');count=load(p)['latestHeadsAccepted']
    require(all(a.get(k)==count for k in ['acceptedLatestHeads','latestVerifiedAccepted','latestHeadsAccepted','authoritativeAcceptedLatest','latestVerifiedAcceptedHeads']),'active_aliases_inconsistent')
    require(count<393,'scope_complete')
    return {'source':source,'version':version,'queue':queue,'prior':prior,'nextCount':count+1,'active':active}

def record(options,after_receipt=lambda:None):
    source=options['source'];version=options['version'];q=pathlib.Path(options['queue']);prior=options['prior'];p=pathlib.Path(prior['path']);active=pathlib.Path(options['active']);count=options['nextCount']
    verify(prior);old=load(p);require(old['latestHeadsAccepted']+1==count and count<=393,'predecessor_count')
    r=load(q/'normal-reader.json');require(r.get('complete')is True and r.get('exact')is True and r.get('expectedSourceId')==source and r.get('expectedVersion')==version and r.get('internalTokens',{}).get('allRevoked')is True,'reader_preservation')
    require(all(r['accessAndComments'].get(k)is True for k in ['visibilityExact','linkRoleExact','sharesExact','guestPolicyExact','commentsExact']),'reader_preservation')
    heads=list((q/'receipts').glob('head-*.json'));pub=list((q/'receipts').glob('publication-*.json'));require(len(heads)==len(pub)==1,'receipt_cardinality')
    comparison=load(q/'comparison.json');raw=pathlib.Path(comparison['comparisonPath']);verify({'path':str(raw),'sha256':comparison['comparisonSha256']});strict=load(raw).get('passed');require(type(strict)is bool and ((comparison['status']=='verified'and strict)or(comparison['status']=='difference'and not strict)),'comparison_binding')
    assets=len(r['rows'][0]['assets']);out={**old,'latestHeadsAccepted':count,'knownAssetReferencesExcludingOriginalCanary':old['knownAssetReferencesExcludingOriginalCanary']+assets,'prior':ref(p),'additional':[{'sourceId':source,'reader':ref(q/'normal-reader.json'),'head':ref(heads[0]),'publication':ref(pub[0]),'assets':assets,'datasets':len(r['datasets']),'datasetObjects':r['datasetObjects'],'accessAndComments':r['accessAndComments'],'acceptanceScope':ref(q/'acceptance-scope.private.json'),'strictComparisonPassed':strict,'practicalAccepted':not strict}],'productionWriterJobsActive':0,'createdAt':datetime.datetime.now(datetime.timezone.utc).isoformat()}
    receipt=p.parent/f'accepted{count}-completion.private.json'
    # Shared writer grant remains mandatory. This additional POSIX lock serializes recorder restarts.
    with active.with_name(active.name+'.completion.lock').open('a')as lock:
        fcntl.flock(lock,fcntl.LOCK_EX)
        a=load(active);cursor=p;seen=set()
        if a['latestHeadsAccepted']<=old['latestHeadsAccepted']:
            while load(cursor)['latestHeadsAccepted']>a['latestHeadsAccepted']:
                require(str(cursor)not in seen,'receipt_cycle');seen.add(str(cursor));previous=load(cursor)['prior'];verify(previous);cursor=pathlib.Path(previous['path'])
            require(load(cursor)['latestHeadsAccepted']==a['latestHeadsAccepted']and ref(cursor)['sha256']==a['latestCompletionReceiptSha256'],'active_chain')
        else:require(receipt.exists(),'active_chain')
        if receipt.exists():
            existing=load(receipt);require({k:v for k,v in existing.items()if k!='createdAt'}=={k:v for k,v in out.items()if k!='createdAt'},'receipt_collision');out=existing
        else:atomic(receipt,out)
        after_receipt();a=load(active);cursor=receipt;seen=set()
        # Never downgrade an advanced head. Prove either direction through exact immutable receipts.
        if a['latestHeadsAccepted']>count:
            cursor=pathlib.Path(a['latestCompletionReceipt']);verify({'path':str(cursor),'sha256':a['latestCompletionReceiptSha256']})
            while load(cursor)['latestHeadsAccepted']>count:
                require(str(cursor)not in seen,'receipt_cycle');seen.add(str(cursor));previous=load(cursor)['prior'];verify(previous);cursor=pathlib.Path(previous['path'])
            require(ref(cursor)==ref(receipt),'active_chain')
        else:
            while load(cursor)['latestHeadsAccepted']>a['latestHeadsAccepted']:
                require(str(cursor)not in seen,'receipt_cycle');seen.add(str(cursor));previous=load(cursor)['prior'];verify(previous);cursor=pathlib.Path(previous['path'])
            require(load(cursor)['latestHeadsAccepted']==a['latestHeadsAccepted']and ref(cursor)['sha256']==a['latestCompletionReceiptSha256'],'active_chain')
            for key in ['acceptedLatestHeads','latestVerifiedAccepted','latestHeadsAccepted','authoritativeAcceptedLatest','latestVerifiedAcceptedHeads']:a[key]=count
            for key in ['acceptedAssetReferences','latestVerifiedAssetReferences']:a[key]=out['knownAssetReferencesExcludingOriginalCanary']
            a.update(remaining=393-count,latestCompletionReceipt=str(receipt),latestCompletionReceiptSha256=ref(receipt)['sha256'],authoritativeAcceptedReceipt=str(receipt),latestVerifiedCompletionReceipt=str(receipt),updatedAt=out['createdAt'],authoritativeAccepted={'path':str(receipt),'sha256':ref(receipt)['sha256'],'accepted':count,'assetReferences':out['knownAssetReferencesExcludingOriginalCanary']})
            atomic(active,a)
    return {'accepted':count,'assets':out['knownAssetReferencesExcludingOriginalCanary'],'remaining':393-count,'receipt':ref(receipt)}

if __name__=='__main__':
    p=argparse.ArgumentParser(description=__doc__);p.add_argument('--request');p.add_argument('--output',required=True);p.add_argument('--prepare',action='store_true');p.add_argument('--source');p.add_argument('--version',type=int);p.add_argument('--queue');p.add_argument('--active');a=p.parse_args()
    value=prepare(a.source,a.version,a.queue,a.active)if a.prepare else record(load(a.request));out=pathlib.Path(a.output)
    if out.exists():require(load(out)==value,'completion_output_changed')
    else:atomic(out,value)
    print(json.dumps(value))
