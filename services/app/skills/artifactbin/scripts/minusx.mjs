/** What this command does and how to use it; also printed by --help. */
export const DESCRIPTION = `Governed data: a group's MinusX connections, and a page pinned to one.
Usage: node scripts/minusx.mjs connections --group GROUP
       node scripts/minusx.mjs catalog --group GROUP --connection CONNECTION
       node scripts/minusx.mjs context --group GROUP --connection CONNECTION
       node scripts/minusx.mjs bind PAGE --name NAME --group GROUP --connection CONNECTION
Flags: --server ORIGIN, --json, --output FILE (exclusive; never overwrites), --help.
Examples:
  node scripts/minusx.mjs connections --group finance
  node scripts/minusx.mjs catalog --group finance --connection conn_finance
  node scripts/minusx.mjs bind PAGE12 --name FIN --group finance --connection conn_finance
Gotchas: only on a server whose /api/server names minusx (combined mode); elsewhere every verb
  refuses with minusx_not_configured. GROUP is an ID, handle or @handle you belong to directly;
  each read runs under exactly that one group, never your others. connections, catalog and
  context send your saved grant to the MinusX address that server names, with X-MinusX-Group;
  the grant needs the minusx scope. bind pins NAME, declared 'minusx' in the published page's
  function secrets, to {connection_id, group_id}; the server checks that you are a member and
  that the group can see the connection, and stores no password. Viewers then read as
  themselves under that group, never as you (references/governed-data.md).
Exit: 0 ok; 1 failed; 2 invocation; 3 auth/access; 4 conflict. Results never contain
  credentials.`;

import {runTool,makeClient,selectedServer,resolveTarget,positional,requireFlags,
 ToolError} from './toolbox-client.mjs';
import {resolveGroup,segment} from './toolbox-groups.mjs';

const ID=/^[A-Za-z0-9_.:-]{1,128}$/;
const connectionId=value=>{if(typeof value!=='string'||!ID.test(value))throw new ToolError(
 'invalid_connection','Use the connection id that connections lists.',2);return value;};
/** The installation's MinusX control API, from the selected server's own identity document. */
async function minusxBase(client){
 const identity=await client.request('/api/server',{authenticated:false});
 const base=identity?.minusx?.base_url;
 if(typeof base!=='string')throw new ToolError('minusx_not_configured',
  'This server has no MinusX (its /api/server names none).',3,
  'Governed data needs a combined installation; use a dataset or caps.db here instead.');
 const url=new URL(base);
 if(!/^https?:$/.test(url.protocol)||url.username||url.password||url.search||url.hash)
  throw new ToolError('invalid_response','The advertised MinusX address is not a plain origin.',1);
 return url.href.replace(/\/+$/,'');
}
/** One MinusX read as the signed-in user under exactly one group (contract §4.1, agent caller). */
async function read(client,group,route){
 const base=await minusxBase(client),{token}=await client.grant();
 let response;
 try{response=await client.fetcher(base+'/api/v1'+route,{redirect:'error',
  headers:{Authorization:'Bearer '+token,'X-MinusX-Group':group,Accept:'application/json'},
  signal:AbortSignal.timeout(30000)});}
 catch{throw new ToolError('network_unavailable','MinusX request failed.',1,'Retry later.');}
 const body=await response.json().catch(()=>null);
 if(response.ok&&body&&typeof body==='object')return body;
 const code=typeof body?.error?.code==='string'?body.error.code:'http_'+response.status;
 throw new ToolError(code,`MinusX refused (HTTP ${response.status}).`,[401,403,404].includes(
  response.status)?3:response.status===409?4:1,response.status===401?'The grant may lack the '+
  'minusx scope; sign in again for it.':'Check your membership of the group and the id.');
}

export async function minusxCommand({sub,values,positionals},options={}){
 positional(positionals,sub==='bind'?1:0);
 requireFlags(values,['group',...(sub==='connections'?[]:['connection']),
  ...(sub==='bind'?['name']:[])]);
 const connection=sub==='connections'?undefined:connectionId(values.connection);
 if(sub==='bind'&&!/^[A-Z][A-Z0-9_]{0,63}$/.test(values.name))throw new ToolError('invalid_name',
  '--name is the upper-case secrets name declared \'minusx\'.',2);
 const target=sub==='bind'?resolveTarget(positionals[0],selectedServer(values,options.env)):null;
 const client=makeClient(target?.server??selectedServer(values,options.env),options);
 const {group}=await resolveGroup(client,values.group);
 const query=connection?'?connection_id='+segment(connection):'';
 if(sub==='connections')return {group:group.id,...await read(client,group.id,'/connections')};
 if(sub==='catalog')return {group:group.id,...await read(client,group.id,'/catalog'+query)};
 if(sub==='context')return {group:group.id,...await read(client,group.id,'/context'+query)};
 if(sub!=='bind')throw new ToolError('invalid_invocation','Choose a documented subcommand.',2);
 const {resolvers}=await client.request('/api/my/artifacts/'+segment(target.id)+'/resolvers');
 const resolver=(resolvers??[]).find(item=>item?.secrets?.[values.name]==='minusx');
 if(!resolver)throw new ToolError('undeclared_connection',`No function file on ${target.id} `+
  `declares ${values.name}: 'minusx'.`,2,'Add it to the file\'s secrets export and publish first.');
 const binding={connection_id:connection,group_id:group.id};
 const answer=await client.request('/api/my/resolvers/'+segment(resolver.backendId)+'/'+
  segment(resolver.version)+'/secrets',{method:'PUT',unsafe:true,safeToRepeat:true,
  body:{name:values.name,binding}});
 return {page:target.id,resolver:resolver.name,name:values.name,binding,set:answer?.names??[]};
}
await runTool('minusx',import.meta.url,minusxCommand);
