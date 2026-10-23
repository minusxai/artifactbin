import {describe,it,expect} from 'vitest';
import {composePageSchema,executePageOperation,FieldFailed} from '../index';
const signal=new AbortController().signal;
const sources=[{name:'tasks',fileId:'backend1',version:'sha1',typeDefs:'type Query { value: Int } type Mutation { save(n:Int!):Int @auth(role:EDITOR) }'}];
describe('page resolver isolation and authority',()=>{
 it('derives principal from caller and refuses viewer mutation before invoke',async()=>{
  const calls:unknown[]=[];const schema=composePageSchema(sources);
  const result=await executePageOperation({schema,request:{query:'mutation { tasks { save(n:2) } }'},caller:{pageId:'page1',subject:'user1',role:'VIEWER'},invoke:async c=>{calls.push(c);return 2;},signal});
  expect(calls).toEqual([]);expect(result.extensions?.outcomes).toEqual({'tasks.save':'rejected'});
 });
 it('does not replay an unknown mutation and still runs the next mutation serially',async()=>{
  const calls:string[]=[];const schema=composePageSchema(sources);
  const result=await executePageOperation({schema,request:{query:'mutation { tasks { first:save(n:1) second:save(n:2) } }'},caller:{pageId:'page1',subject:'user1',role:'EDITOR'},invoke:async c=>{calls.push(c.field);expect(c.principal).toEqual({tenant:'page1',subject:'user1'});if(c.args.n===1)throw new FieldFailed('deadline');return 2;},signal});
  expect(calls).toEqual(['save','save']);expect(result.extensions?.outcomes).toEqual({'tasks.first':'unknown','tasks.second':'committed'});
 });
 it('keeps duplicate file type names in private namespaces',()=>{
  const schema=composePageSchema([{...sources[0]!,typeDefs:'type Query { value: Thing } type Thing { n:Int }'},{name:'other',fileId:'backend2',version:'sha2',typeDefs:'type Query { value: Thing } type Thing { s:String }'}]);
  expect(schema.sdl).toContain('tasks__Thing');expect(schema.sdl).toContain('other__Thing');
 });
});
it('preflights the actual bounded operation rather than trusting a page label',async()=>{
 const {pageOperationKind}=await import('../index');
 expect(pageOperationKind('mutation { tasks { save(n:2) } }')).toBe('mutation');
 expect(pageOperationKind('query A { tasks { value } } mutation B { tasks { save(n:2) } }','B')).toBe('mutation');
 expect(pageOperationKind('query A { tasks { value } } mutation B { tasks { save(n:2) } }')).toBeNull();
});

it('preserves authoritative adapter receipt outcomes without interpreting arbitrary backend JSON',async()=>{
 let calls=0;
 const schema=composePageSchema([{name:'data',fileId:'dataset1',version:'live',typeDefs:'type Receipt { outcome:String! } type Query { x:Int } type Mutation { write:Receipt! }'}]);
 const result=await executePageOperation({schema,request:{query:'mutation { data { rejected:write {outcome} unknown:write {outcome} author:write {outcome} } }'},caller:{pageId:'page1',subject:'u1',role:'OWNER'},signal,invoke:async call=>{
  if(call.field!=='write')return null;
  calls++;
  if(calls===1)call.reportOutcome?.('rejected');
  if(calls===2)call.reportOutcome?.('unknown');
  return {outcome:calls===2?'unknown':'rejected'};
 }});
 expect(result.extensions?.outcomes).toEqual({'data.rejected':'rejected','data.unknown':'unknown','data.author':'committed'});
 expect(result.data).toEqual({data:{rejected:{outcome:'rejected'},unknown:{outcome:'unknown'},author:{outcome:'rejected'}}});
});
