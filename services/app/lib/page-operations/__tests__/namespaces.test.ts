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
