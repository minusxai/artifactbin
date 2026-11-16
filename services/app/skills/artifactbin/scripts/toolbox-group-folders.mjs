/** Internal: one-page group collections and durable folder creation Used by groups.mjs.
 * Folder journals contain only the exact create body, never HTML source or credentials. */
import {ToolError,makeClient,selectedServer,serverOrigin,resolveTarget,positional,integer,
 jsonFile,journalIntent,createJournal,resumeJournal} from './toolbox-client.mjs';
import {folderBody} from './toolbox-journal.mjs';
import {groupReference,resolveGroup,segment} from './toolbox-groups.mjs';

export async function groupFolders({sub,values,positionals},options){
 let client,journal;
 if(values.resume){
  positional(positionals,0);
  if(sub!=='folder-create'||Object.keys(values).some(key=>
   !['resume','server','json','output'].includes(key)))throw new ToolError('resume_overrides',
   'Resume accepts no overrides.',2);
  const saved=await jsonFile(values.resume);
  client=makeClient(serverOrigin(selectedServer(values,options.env)??saved?.server),
   {...options,retryDelays:[]});
  journal=values.resume;
 }else{
  groupReference(positional(positionals));
  const server=serverOrigin(selectedServer(values,options.env));
  const parent=values.parent===undefined?undefined:resolveTarget(values.parent,server).id;
  if(values.limit!==undefined)integer(values.limit,'limit',1,100);
  const body=sub==='folder-create'?folderBody({format:'folder',title:values.title,
   visibility:'private',destination:{type:'group',id:'pending'},
   ...(parent!==undefined?{parent_id:parent}:{})}):null;
  client=makeClient(server,{...options,retryDelays:[]});
  const {group}=await resolveGroup(client,positionals[0]);
  if(sub==='collection'){
   const query=new URLSearchParams();
   if(parent!==undefined)query.set('parent_id',parent);
   for(const key of ['cursor','limit'])if(values[key]!==undefined)query.set(key,values[key]);
   return client.request('/api/groups/'+segment(group.id)+'/collection'+
    (query.size?'?'+query:''));
  }
  if(!['editor','admin'].includes(group.role))throw new ToolError('group_not_editor',
   'Creating a group folder needs Editor or Admin access.',3);
  body.destination.id=group.id;
  journal=await createJournal(journalIntent({server,method:'POST',path:'/api/artifacts',
   operation:'folder-create',body}),{file:values.request,root:client.root,
    project:options.project??process.cwd()});
 }
 const {receipt}=await resumeJournal(journal,client,'folder-create');
 return {id:receipt.id,title:receipt.title,url:receipt.url??client.server+'/a/'+receipt.id,
  parent_id:receipt.parent_id??null,format:receipt.format??'folder',journal};
}
