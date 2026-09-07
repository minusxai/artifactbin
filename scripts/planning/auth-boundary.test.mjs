/** Planning prototype only: proves the proposed policy, not production integration. */
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {boundary, singleCookie, safeReturn} from './auth-boundary.mjs';
const main='https://artifactbin.test', trusted='https://i.artifactbin.test';
const session={id:'s1',active:true,csrf:'csrf-fixture',user:'viewer'};
const manifest={doc:'doc1',revision:'hash1',target:'ds1',operation:'insert'};
const good={host:trusted,origin:trusted,method:'POST',contentType:'application/json',csrf:session.csrf,session,manifest,approved: {...manifest,user:'viewer',session:'s1'},acl:true,requestId:1};
test('exact cookie parser rejects duplicate authority',()=>{
 assert.equal(singleCookie('full=a; full=b','full'),null);
 assert.equal(singleCookie('other=a; full=b','full'),'b');
});
test('safe return URLs reject authority changes and credentials',()=>{
 for(const url of ['https://evil.test','//evil.test','javascript:alert(1)','https://user@artifactbin.test/a/x']) assert.equal(safeReturn(url,main),null);
 assert.equal(safeReturn('/a/x?view=table',main),main+'/a/x?view=table');
});
test('approved mutation succeeds exactly once',()=>{
 const check=boundary(trusted); assert.equal(check(good),200); assert.equal(check(good),409);
});
for(const [name,patch] of Object.entries({
 'root host':{host:main},'root origin':{origin:main},'null origin':{origin:'null'},'missing origin':{origin:null},
 'sibling origin':{origin:'https://evil.artifactbin.test'},'lookalike origin':{origin:trusted+'.evil.test'},
 'simple form':{contentType:'application/x-www-form-urlencoded'},'text plain':{contentType:'text/plain'},'GET write':{method:'GET'},
 'missing csrf':{csrf:null},'bad csrf':{csrf:'bad'},'no session':{session:null},'read credential only':{session:null,read:'read-fixture'},
 'revoked session':{session:{...session,active:false}},'revoked ACL':{acl:false},'no consent':{approved:null},
 'wrong user':{approved:{...good.approved,user:'other'}},'old session consent':{approved:{...good.approved,session:'old'}},
 'changed definition':{manifest:{...manifest,revision:'hash2'}},'wrong document':{manifest:{...manifest,doc:'doc2'}},
 'wrong target':{manifest:{...manifest,target:'ds2'}},'wrong operation':{manifest:{...manifest,operation:'delete'}},
 'invalid sequence':{requestId:NaN},
})) test(name+' denied',()=>assert.notEqual(boundary(trusted)({...good,...patch}),200));
