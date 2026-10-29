import {it,expect} from 'vitest';
import {createPageOperations} from '../service';
import type { AccessActor } from '@/lib/accounts';
const actor:AccessActor={userId:'actual-user',tokenId:null,email:null,documentEditor:false};
it('maps original commenter authority to resolver viewer and ignores forged variables',async()=>{
 let invoked=false;
 const service=createPageOperations({readPage:async()=>({pageId:'page1',version:1,revision:'1',html:'',nextNodeId:1,links:[]}),role:async()=> 'commenter',sources:async()=>[{name:'test',fileId:'backend1',version:'1',typeDefs:'type Query { value:Int } type Mutation { write:Int @auth(role:EDITOR) }'}],invoke:async()=>{invoked=true;return 1;}});
 const result=await service.execute(actor,{pageId:'page1',revision:'1',query:'mutation { test { write } }',variables:{role:'OWNER',subject:'forged-user'}},new AbortController().signal);
 expect(invoked).toBe(false);expect(result.extensions?.outcomes).toEqual({'test.write':'rejected'});
});
