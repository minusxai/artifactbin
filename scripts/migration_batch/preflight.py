"""Validate the actual normal-reader CLI argument before any once-apply stage."""
import argparse,pathlib
from runner import load,require

def reader_config(path):
    v=load(path)
    require(all(isinstance(v.get(k),str)and v[k]for k in ['receiptRoot','batchPath','planPath','outputDirectory']),'reader_cli_config_shape')
    require(pathlib.Path(v['receiptRoot']).is_dir(),'reader_receipt_root')
    require(all(pathlib.Path(v[k]).is_file()for k in ['batchPath','planPath']),'reader_config_inputs')
    return {'valid':True,'format':'migration-reader-cli-preflight-v1'}
if __name__=='__main__':
    p=argparse.ArgumentParser(description=__doc__);p.add_argument('--config',required=True);a=p.parse_args();print(reader_config(a.config))
