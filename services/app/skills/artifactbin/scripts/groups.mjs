/** What this command does and how to use it; also printed by --help. */
export const DESCRIPTION = `Groups: membership, invitations, sharing, ownership and links.
Usage: node scripts/groups.mjs list
       node scripts/groups.mjs show GROUP [--pages] [--cursor CURSOR]
       node scripts/groups.mjs create HANDLE --name NAME [--description TEXT]
       node scripts/groups.mjs update GROUP [--name NAME] [--description TEXT]
       node scripts/groups.mjs invite GROUP EMAIL... [--role viewer|editor] [--yes]
       node scripts/groups.mjs uninvite GROUP EMAIL --yes
       node scripts/groups.mjs role GROUP USER --role viewer|editor [--yes]
       node scripts/groups.mjs remove GROUP USER --yes
       node scripts/groups.mjs leave GROUP --yes
       node scripts/groups.mjs share PAGE --group GROUP [--role viewer|commenter|editor]
         [--datasets] [--yes]
       node scripts/groups.mjs unshare PAGE --group GROUP [--datasets] --yes
       node scripts/groups.mjs move PAGE --group GROUP|--personal --yes
       node scripts/groups.mjs link GROUP OTHER_GROUP
       node scripts/groups.mjs unlink GROUP OTHER_GROUP --yes
       node scripts/groups.mjs delete GROUP --handle HANDLE --yes
Flags: --server ORIGIN, --json, --output FILE (exclusive; never overwrites), --help.
Examples:
  node scripts/groups.mjs create design_crit --name "Design Crit"
  node scripts/groups.mjs invite design_crit one@example.test two@example.test --role viewer
  node scripts/groups.mjs share PAGE12 --group design_crit --role commenter
  node scripts/groups.mjs share PAGE12 --group design_crit --datasets
  node scripts/groups.mjs show design_crit --pages
Gotchas: GROUP is an ID, handle or @handle, resolved once; writes use stable IDs. USER must
  resolve uniquely inside that group's current members (ID, handle or exact name); invite by email
  to add someone. Invitations are listed only for editors; uninvite resolves their email there.
  Multiple invitations return individual successes/failures; a partial failure is not atomic.
  Share preserves personal ownership and host. Move deliberately transfers ownership, including
  folder descendants; publish --group instead creates new group-owned work. Links only navigate.
  A page share never lets members change a dataset's rows. --datasets also shares each dataset
  the page links with the group at viewer, never editor, so the dataset's rules decide (a team
  tracker's members then change every entry); unshare --datasets takes them back too.
  --yes (destructive actions, editor invitations, promotions, page shares) needs the user's
  consent in this conversation (references/groups.md).
  Delete requires an empty group and its exact current handle; deployment defaults are protected.
  Unknown write outcomes must be reconciled by reading current state before another write.
Exit: 0 ok; 1 failed or partial failure; 2 invocation/confirmation; 3 auth/access; 4 conflict;
  5 unknown write outcome. Results never contain credentials.`;

import {runTool,makeClient,selectedServer,resolveTarget,positional,requireFlags,enumValue,
 ToolError,toolFailure,toolExit} from './toolbox-client.mjs';
import {confirmation,groupReference,resolveGroup,resolveMember,resolveInvitation,
 invitationEmail,segment,withDatasets,editorGrant,EDITOR_GRANT} from './toolbox-groups.mjs';

/** The step after a listing of members or invitations (show). */
const PROPOSE='Next: members show handles, not email addresses. A change to these members or '+
 'invitations is proposed to the user before it is made: name each member by handle and role (for '+
 'a person the user named by address, the member you take them to be, or the members you cannot '+
 'tell apart; an address missing here does not mean they are not a member) and each invitation '+
 'by its email, with the action for each (remove, change role, cancel the invitation); make it '+
 'only after they agree.';
/** An editor grant's result says what it gave (EDITOR_GRANT). */
export async function groupsCommand(parsed,options={}){
 const result=await command(parsed,options);
 return editorGrant(parsed.sub,parsed.values.role)&&result&&typeof result==='object'?
  {...result,note:EDITOR_GRANT}:result;
}
async function command({sub,values,positionals},options){
 // These checks precede even identity lookup HTTP, so refusal cannot accidentally mutate.
 confirmation(sub,values);
 const pageVerb=['share','unshare','move'].includes(sub);
 if(sub==='invite'){
  if(positionals.length<2)throw new ToolError('invalid_arguments',
  'Supply GROUP and one or more emails.',2);
 }else positional(positionals,sub==='list'?0:['role','remove','uninvite','link',
  'unlink'].includes(sub)?2:1);
 let role;
 if(['invite','role','share'].includes(sub)){
  if(sub==='role')requireFlags(values,['role']);
  role=enumValue(values.role??'viewer',sub==='share'?['viewer','commenter','editor']:['viewer',
  'editor'],'role');
 }
 if(values.datasets&&role==='editor')throw new ToolError('datasets_editor',
  '--datasets shares the linked datasets at viewer: a dataset editor bypasses its rules.',2,
  'Share at viewer or commenter with --datasets; an editor share of a dataset goes by its ID.');
 if(sub==='delete')requireFlags(values,['handle']);
 if(sub==='move'&&Boolean(values.group)===Boolean(values.personal))
  throw new ToolError('invalid_destination','Choose exactly one of --group or --personal.',2);
 if(['share','unshare'].includes(sub))requireFlags(values,['group']);
 if(values.cursor&&!values.pages)throw new ToolError('invalid_cursor',
  '--cursor requires show --pages.',2);
 const patch={};
 if(['create','update'].includes(sub)){
  if(sub==='create')requireFlags(values,['name']);
  for(const key of ['name','description'])if(values[key]!==undefined){
   if(typeof values[key]!=='string'||key==='name'&&!values[key].trim())
  throw new ToolError('invalid_'+key,'Supply a nonblank name.',2);
   patch[key]=values[key];
  }
  if(sub==='update'&&!Object.keys(patch).length)throw new ToolError('empty_patch',
  'Supply --name or --description.',2);
 }
 const emails=sub==='invite'?positionals.slice(1).map(invitationEmail):[];
 const email=sub==='uninvite'?invitationEmail(positionals[1]):undefined;
 if(!pageVerb&&sub!=='list')groupReference(positionals[0]);
 if(values.group)groupReference(values.group);
 if(['link','unlink'].includes(sub))groupReference(positionals[1]);
 const target=pageVerb?resolveTarget(positionals[0],selectedServer(values,options.env)):null;
 const client=makeClient(target?.server??selectedServer(values,options.env),options);
 const write=(path,method,body)=>client.request(path,{method,body,unsafe:true});
 if(sub==='list')return client.request('/api/groups');
 if(sub==='create')return write('/api/groups','POST',{handle:positionals[0],...patch});
 if(sub==='move'&&values.personal)return write('/api/artifacts/'+target.id+'/transfer','POST',
  {destination:{type:'personal'}});
 const detail=await resolveGroup(client,pageVerb?values.group:positionals[0]);
 const group=detail.group,base='/api/groups/'+segment(group.id);
 if(sub==='show'){
  // Members show handles, not the addresses the user knows them by: a change names who, then waits.
  const shown={...detail,...([detail.members,detail.invitations].some(list=>list?.length)?{next:
   PROPOSE}:{})};
  if(!values.pages)return shown;
  const query=new URLSearchParams({group_id:group.id});if(values.cursor)query.set('cursor',
  values.cursor);
  return {...shown,pages:await client.request('/api/artifacts?'+query)};
 }
 if(sub==='update')return write(base,'PATCH',patch);
 if(sub==='delete'){
  if(values.handle!==group.handle)throw new ToolError('handle_mismatch',
  'Echo the exact current group handle with --handle.',2);
  return write(base,'DELETE',{handle:values.handle});
 }
 if(sub==='invite'){
  const results=[];
  for(const email of emails){try{results.push({email,ok:true,result:await
  write(base+'/invitations','POST',{email,role})});}
   catch(error){results.push({email,...toolFailure('groups',error),exit:toolExit(error)});}}
  const failures=results.filter(result=>!result.ok);
  return {ok:failures.length===0,code:failures.length?'partial_failure':'completed',group,results,
   ...(failures.length?{exit:Math.max(...failures.map(result=>result.exit))}:{})};
 }
 if(sub==='uninvite')return write(base+'/invitations/'+segment(await resolveInvitation(client,
  group.id,email)),'DELETE');
 if(['role','remove'].includes(sub)){
  const user=await resolveMember(client,group.id,positionals[1]);
  return write(base+'/members/'+segment(user),sub==='role'?'PUT':'DELETE',
  sub==='role'?{role}:undefined);
 }
 if(sub==='leave')return write(base+'/members/me','DELETE');
 if(['share','unshare'].includes(sub)){
  const send=(id,as)=>write('/api/artifacts/'+id+'/group-shares/'+segment(group.id),
   sub==='share'?'PUT':'DELETE',sub==='share'?{role:as}:undefined);
  return values.datasets?withDatasets(client,target.id,sub==='share'?role:undefined,send):
   send(target.id,role);
 }
 if(sub==='move')return write('/api/artifacts/'+target.id+'/transfer','POST',
  {destination:{type:'group',id:group.id}});
 if(['link','unlink'].includes(sub)){
  const linked=await resolveGroup(client,positionals[1]);
  return write(base+'/links/'+segment(linked.group.id),sub==='link'?'PUT':'DELETE');
 }
 throw new ToolError('invalid_invocation','Choose a documented groups subcommand.',2);
}
await runTool('groups',import.meta.url,async parsed=>{
 const result=await groupsCommand(parsed);if(result.ok===false)process.exitCode=result.exit??1;
  return result;
});
