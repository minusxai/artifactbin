/**
 * scripts/minusx.mjs: discovery runs as the signed-in agent under exactly one group (the saved grant plus
 * `X-MinusX-Group`, contract §4.1) against the MinusX address the selected server's `/api/server` advertises, and
 * `bind` stores a page's `'minusx'` name as `{connection_id, group_id}` through the owner's resolver settings route.
 */
import {it,expect} from 'vitest';
const server='https://example.test',MINUSX='https://minusx.example.test';
type Call={url:string;method:string;headers:Record<string,string>;body:any};
async function run(sub:string,positionals:string[],values:Record<string,unknown>,answer:(call:Call)=>Response|undefined=()=>undefined){
 const {minusxCommand}=await import('../../../skills/artifactbin/scripts/minusx.mjs');
 const calls:Call[]=[];
 const result=await minusxCommand({sub,positionals,values},{env:{ARTIFACTBIN_URL:server,ARTIFACTBIN_TOKEN:'synthetic'},fetcher:async(url:any,init:any={})=>{
  const headers=Object.fromEntries(new Headers(init.headers).entries());
  const call={url:String(url),method:init.method??'GET',headers,body:init.body?JSON.parse(init.body):undefined};calls.push(call);
  const own=answer(call);if(own)return own;
  const path=new URL(call.url).pathname;
  if(path==='/api/server')return Response.json({origin:server,aliases:[],installation_id:'installation_demo',minusx:{base_url:MINUSX}});
  if(path.startsWith('/api/groups/'))return Response.json({group:{id:'grp_finance',handle:'finance'},members:[]});
  if(path==='/api/v1/connections')return Response.json({connections:[{id:'conn_finance',name:'Finance',protocol:'postgres',policy_revision:3}]});
  if(path==='/api/v1/catalog')return Response.json({connection_id:'conn_finance',schemas:[]});
  if(path==='/api/my/artifacts/PAGE12/resolvers')return Response.json({resolvers:[{name:'data',backendId:'b1',version:'v1',secrets:{FIN:'minusx',KEY:'api.example.com'}}]});
  if(path==='/api/my/resolvers/b1/v1/secrets')return Response.json({names:['FIN']});
  return Response.json({error:'not_found'},{status:404});
 }});
 return {result,calls};
}
it('connections and catalog read MinusX under the one resolved group, with the saved grant and nothing else',async()=>{
 const {result,calls}=await run('connections',[],{group:'finance'});
 expect(result).toMatchObject({group:'grp_finance',connections:[{id:'conn_finance'}]});
 const read=calls.at(-1)!;
 expect(read).toMatchObject({url:MINUSX+'/api/v1/connections',method:'GET'});
 expect(read.headers).toMatchObject({authorization:'Bearer synthetic','x-minusx-group':'grp_finance'});
 // The identity document is read without a credential.
 expect(calls.find(call=>call.url.endsWith('/api/server'))!.headers.authorization).toBeUndefined();
 const catalog=await run('catalog',[],{group:'finance',connection:'conn_finance'});
 expect(catalog.calls.at(-1)!.url).toBe(MINUSX+'/api/v1/catalog?connection_id=conn_finance');
});
it('refuses on a server without MinusX before sending the grant anywhere',async()=>{
 const refused=run('connections',[],{group:'finance'},call=>call.url.endsWith('/api/server')?Response.json({origin:server,aliases:[]}):undefined);
 await expect(refused).rejects.toMatchObject({code:'minusx_not_configured',exit:3});
});
it('names MinusX\'s refusal code',async()=>{
 const refused=run('context',[],{group:'finance',connection:'conn_finance'},call=>call.url.startsWith(MINUSX)?Response.json({error:{code:'forbidden',message:'no'}},{status:403}):undefined);
 await expect(refused).rejects.toMatchObject({code:'forbidden',exit:3});
});
it('bind stores {connection_id, group_id} for the name the page declares \'minusx\'',async()=>{
 const {result,calls}=await run('bind',['PAGE12'],{group:'finance',connection:'conn_finance',name:'FIN'});
 expect(calls.at(-1)).toMatchObject({url:server+'/api/my/resolvers/b1/v1/secrets',method:'PUT',body:{name:'FIN',binding:{connection_id:'conn_finance',group_id:'grp_finance'}}});
 expect(result).toEqual({page:'PAGE12',resolver:'data',name:'FIN',binding:{connection_id:'conn_finance',group_id:'grp_finance'},set:['FIN']});
});
it('bind refuses a name not declared \'minusx\', and bad input before any HTTP',async()=>{
 const undeclared=await run('bind',['PAGE12'],{group:'finance',connection:'conn_finance',name:'KEY'}).catch(error=>error);
 expect(undeclared).toMatchObject({code:'undeclared_connection'});
 const {minusxCommand}=await import('../../../skills/artifactbin/scripts/minusx.mjs');let calls=0;
 const fetcher=async()=>{calls++;throw Error('unexpected');};
 await expect(minusxCommand({sub:'bind',positionals:['PAGE12'],values:{group:'finance',connection:'conn finance',name:'FIN'}},{fetcher})).rejects.toMatchObject({code:'invalid_connection',exit:2});
 await expect(minusxCommand({sub:'bind',positionals:['PAGE12'],values:{group:'finance',connection:'conn_finance',name:'fin'}},{fetcher})).rejects.toMatchObject({code:'invalid_name',exit:2});
 await expect(minusxCommand({sub:'catalog',positionals:[],values:{group:'finance'}},{fetcher})).rejects.toMatchObject({code:'missing_connection',exit:2});
 expect(calls).toBe(0);
});
