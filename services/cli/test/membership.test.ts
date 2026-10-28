import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cliHarness } from './harness';

test('invite sends usernames together under the current account without inventing membership', async () => {
  const h=await cliHarness('afbin-members-');
  try {
    const code=await h.invoke(['invite','a1B2c3','@alex','@sam','--json'],call=>{
      assert.equal(call.method,'POST');
      assert.equal(call.path,'/api/artifacts/a1B2c3/members');
      assert.deepEqual(call.body,{action:'invite',usernames:['@alex','@sam']});
      return Response.json({members:[],pending:[{user_id:'usr_alex'}]});
    });
    assert.equal(code,0,JSON.stringify(h.last()));
    assert.equal(h.last().pending.length,1);
  } finally {await h.cleanup();}
});
test('join requests server approval; members lists the current state', async()=>{
  const h=await cliHarness('afbin-join-');
  try{
    assert.equal(await h.invoke(['join','a1B2c3','--json'],call=>{
      assert.deepEqual(call.body,{action:'join'});return Response.json({self:{status:'pending'}});
    }),0);
    assert.equal(h.last().self.status,'pending');
    assert.equal(await h.invoke(['members','a1B2c3','--json'],call=>{
      assert.equal(call.method,'GET');return Response.json({members:[]});
    }),0);
  }finally{await h.cleanup();}
});

test('mention resolves a username without sending an invitation',async()=>{
 const h=await cliHarness('afbin-mention-');try{
  assert.equal(await h.invoke(['mention','a1B2c3','@alex','--json'],call=>{assert.equal(call.method,'GET');assert.equal(call.path,'/api/artifacts/a1B2c3/members?query=alex');return Response.json({people:[{user_id:'usr_alex',username:'alex'}]});}),0);
  assert.equal(h.last().mentions[0].markdown,'[@alex](/people/usr_alex)');
 }finally{await h.cleanup();}
});

test('invite includes viewing access only with the explicit flag',async()=>{
 const h=await cliHarness('afbin-invite-access-');try{
  assert.equal(await h.invoke(['invite','a1B2c3','@alex','--include-access','--json'],call=>{
   assert.deepEqual(call.body,{action:'invite',usernames:['@alex'],includeAccess:true});return Response.json({pending:[]});
  }),0);
 }finally{await h.cleanup();}
});
