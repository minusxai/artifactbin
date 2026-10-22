import test from "node:test";
import assert from "node:assert/strict";
import {createCompiledDialogForm} from "../src/migration/conversion/compiled/dialog-form.ts";
const receipt={affected:1,rowCount:1,version:2,generation:1};
function fixture(){
 let resolve!:(value:unknown)=>void,reject!:(reason:unknown)=>void;
 const pending=new Promise<unknown>((yes,no)=>{resolve=yes;reject=no;});
 const f={context:"a" as string|null,unavailable:null as string|null,unknown:false,valid:true,closed:0,validation:0,reads:0,mutations:0,retries:0,busy:false,args:{title:"one"},received:undefined as unknown};
 const model=createCompiledDialogForm({unavailable:()=>f.unavailable,authorizationContext:()=>f.context,unknown:()=>f.unknown,validate:()=>{f.validation++;return f.valid;},args:()=>{f.reads++;return f.args;},mutate:async args=>{f.mutations++;f.received=args;return pending;},reconcile:async()=>{f.retries++;return pending;},busy:value=>{f.busy=value;},close:()=>{f.closed++;}});
 return {f,model,resolve,reject};
}
test("valid form snapshots arguments once, blocks double submit, and closes only after a confirmed receipt",async()=>{
 const x=fixture();const submit=x.model.submit();await x.model.submit();
 x.f.args.title="changed";
 assert.deepEqual(x.f.received,{title:"one"});assert.equal(x.f.mutations,1);assert.equal(x.f.busy,true);assert.equal(x.f.closed,0);
 x.resolve(receipt);await submit;assert.equal(x.f.closed,1);assert.equal(x.f.busy,false);
});
test("invalid, unavailable, unverified and disposed forms never read arguments or dispatch",async()=>{
 for(const mode of ["invalid","unavailable","unverified","disposed"]){const x=fixture();
  if(mode==='invalid')x.f.valid=false;if(mode==='unavailable')x.f.unavailable="Denied";if(mode==='unverified')x.f.context=null;if(mode==='disposed')x.model.dispose();
  await x.model.submit();assert.equal(x.f.mutations,0);assert.equal(x.f.reads,0);assert.equal(x.f.closed,0);
 }
});
test("failure and malformed fulfillment retain the dialog with an error instead of pretending it saved",async()=>{
 for(const value of [undefined,{},true,{...receipt,version:-1}]){const x=fixture();const submit=x.model.submit();x.resolve(value);await submit;assert.equal(x.f.closed,0);assert.ok(x.model.state().error);assert.equal(x.f.busy,false);}
 const x=fixture();const submit=x.model.submit();x.reject(Error("not saved"));await submit;assert.equal(x.model.state().error,"not saved");assert.equal(x.f.closed,0);
});
test("unknown recovery reuses the durable reconcile operation, never new arguments or another mutation",async()=>{
 const x=fixture();x.f.unknown=true;
 await x.model.submit();assert.equal(x.f.mutations,0);
 const reconcile=x.model.reconcile();assert.equal(x.f.retries,1);assert.equal(x.f.reads,0);x.resolve(receipt);await reconcile;assert.equal(x.f.closed,1);
});
test("revocation and disposal retire late UI completion without inventing cancellation of a dispatched write",async()=>{
 for(const mode of ['switch','revoke','dispose']){const x=fixture();const submit=x.model.submit();
 if(mode==='switch')x.f.context='b';if(mode==='revoke'){x.f.context=null;x.f.unavailable='Denied';}if(mode==='dispose')x.model.dispose();
 x.resolve(receipt);await submit;assert.equal(x.f.closed,0);assert.equal(x.f.busy,false);assert.equal(x.model.state().error,null);
 }
});
