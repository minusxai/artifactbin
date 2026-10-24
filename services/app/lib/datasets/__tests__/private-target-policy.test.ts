import {it,expect} from 'vitest';
import {datasetSecretTargetHash} from '../secret-crypto';
import {approvedDatasetPrivateTarget} from '../private-target-policy';
import {parseDatasetPrivateTargetHashes} from '@/lib/platform/config';
const target={host:'reviewed.example.test',port:5432,database:'fixture',username:'reader',ssl:true};
it('approves only an exact server-reviewed connection tuple',()=>{
 const approved=[datasetSecretTargetHash(target)];
 expect(approvedDatasetPrivateTarget(target,[])).toBe(false);expect(approvedDatasetPrivateTarget(target,approved)).toBe(true);
 for(const change of [{host:'other.example.test'},{port:5433},{database:'other'},{username:'other'},{ssl:false}])expect(approvedDatasetPrivateTarget({...target,...change},approved)).toBe(false);
});
it('parses bounded unique configuration fingerprints without accepting network or caller expressions',()=>{
 const hash=datasetSecretTargetHash(target);expect(parseDatasetPrivateTargetHashes(undefined)).toEqual([]);expect(parseDatasetPrivateTargetHashes(' '+hash+' ')).toEqual([hash]);
 for(const value of ['*','10.0.0.0/8','reviewed.example.test',hash+','+hash,Array.from({length:33},(_,i)=>i.toString(16).padStart(64,'0')).join(',')])expect(()=>parseDatasetPrivateTargetHashes(value)).toThrow('DATASET__PRIVATE_TARGET_HASHES');
});
