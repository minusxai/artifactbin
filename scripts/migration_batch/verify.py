"""Read-only reuse of exact existing pipeline evidence; never recaptures/imports."""
import argparse,json,pathlib
from runner import atomic,load,output_refs,require,verify

def audit(spec):
    require(bool(spec['files'])and bool(spec['checks']),'audit_contract')
    for f in spec['files']:verify(f)
    checked=output_refs({'outputs':spec['checks']})
    return {'format':'migration-batch-evidence-audit-v1','verified':True,'inputs':spec['files'],'checks':checked,'productionWrites':0}

if __name__=='__main__':
    p=argparse.ArgumentParser(description=__doc__);p.add_argument('--spec',required=True);p.add_argument('--output',required=True);a=p.parse_args();value=audit(load(a.spec));out=pathlib.Path(a.output)
    if out.exists():require(load(out)==value,'audit_output_changed')
    else:atomic(out,value)
    print(json.dumps({'verified':True,'files':len(value['inputs']),'productionWrites':0}))
