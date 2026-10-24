import {describe,it,expect} from 'vitest';
import {compareSource} from '../source-relationship';
const digest=(letter:string)=>letter.repeat(64);
const base={baseDigest:digest('a'),baseRevision:'1',remoteRevision:'2'};
describe('source relationship truth table',()=>{
 it.each([
 ['match','a','a',false,false,false],
 ['behind','a','b',true,false,false],
 ['local-edits','b','a',false,true,false],
 ['diverged','b','c',false,false,true],
 ['converged','b','b',false,false,false],
 ] as const)('%s follows digest equality',(state,local,remote,pull,publish,merge)=>{
 const result=compareSource({...base,localDigest:digest(local),remoteDigest:digest(remote)});
 expect(result.state).toBe(state);expect(result.actions).toMatchObject({canPull:pull,canPublish:publish,requiresMerge:merge,expectedRemoteRevision:'2'});
 expect(result.remoteRevisionAdvanced).toBe(true);
 });
 it('distinguishes missing base, unread local bytes and unavailable remote independently',()=>{
 const remote={remoteDigest:digest('a'),remoteRevision:'3'};
 expect(compareSource({...remote,localDigest:digest('a')})).toMatchObject({state:'unknown-base',localMatchesRemote:true,evidence:{base:'missing',local:'verified',remote:'known'}});
 expect(compareSource({...base,...remote})).toMatchObject({state:'local-unverified',localMatchesRemote:null,evidence:{local:'unverified'}});
 expect(compareSource({})).toMatchObject({state:'network-unknown',evidence:{base:'missing',local:'unverified',remote:'unavailable'},actions:{canPublish:false,canPull:false,expectedRemoteRevision:null}});
 });
 it('observes remote revision movement independently from identical bytes',()=>{
 const input={...base,localDigest:digest('a'),remoteDigest:digest('a')};
 expect(compareSource(input)).toMatchObject({state:'match',remoteRevisionAdvanced:true,actions:{canAdoptRemoteBase:true,canPublish:false}});
 expect(compareSource({...input,remoteRevision:'1'}).remoteRevisionAdvanced).toBe(false);
 });
 it('normalizes hexadecimal digests and preserves missing provenance',()=>{
 expect(compareSource({...base,localDigest:digest('A'),remoteDigest:digest('a')})).toMatchObject({state:'match',localMatchesRemote:true});
 expect(compareSource({baseDigest:digest('a'),localDigest:digest('a'),remoteDigest:digest('b'),remoteRevision:'2'})).toMatchObject({state:'unknown-base',remoteRevisionAdvanced:null,actions:{canPublish:false,canPull:false}});
 expect(compareSource({...base,remoteRevision:undefined,localDigest:digest('b')})).toMatchObject({state:'network-unknown',evidence:{base:'known',local:'verified',remote:'unavailable'}});
 });
 it.each([
 {baseDigest:'not-a-digest'}, {localDigest:''},{remoteDigest:digest('a')},{remoteRevision:'2'},
 {remoteDigest:digest('a'),remoteRevision:''},{baseRevision:''},{localDigest:5},null,
 ])('rejects malformed or partial observations %j',input=>{
 expect(()=>compareSource(input as never)).toThrow('invalid_source_comparison');
 });
});
