import {it,expect} from 'vitest';
import {createPageOperations} from '../service';
import type { AccessActor } from '@/lib/accounts';
const actor:AccessActor={userId:'actual-user',tokenId:null,email:null,documentEditor:false};
it('refuses a viewer page role an editor field and ignores forged variables',async()=>{
 let invoked=false;
 const service=createPageOperations({readPage:async()=>({pageId:'page1',version:1,revision:'1',html:'',nextNodeId:1,links:[]}),role:async()=> 'viewer',sources:async()=>[{name:'test',fileId:'backend1',version:'1',typeDefs:'type Query { value:Int } type Mutation { write:Int @auth(role: editor) }'}],invoke:async()=>{invoked=true;return 1;}});
 const result=await service.execute(actor,{pageId:'page1',revision:'1',query:'mutation { test { write } }',variables:{role:'OWNER',subject:'forged-user'}},new AbortController().signal);
 expect(invoked).toBe(false);expect(result.extensions?.outcomes).toEqual({'test.write':'rejected'});
});
