/** Internal: personal site settings, page placement and workspace shelves. Used by groups/read. */
import {makeClient,positional,selectedServer,resolveTarget,requireFlags,enumValue,ToolError}
 from './toolbox-client.mjs';

export async function siteCommand(sub,values,args,options){
 const server=selectedServer(values,options.env),client=makeClient(server,options);
 const folder=value=>value==='root'?null:resolveTarget(value,client.server).id;
 const value=positional(args,sub==='website'?0:1),path='/api/my/website';
 if(sub==='website')return client.request(path);
 if(sub==='place'){
  requireFlags(values,['parent']);
  const page='/api/artifacts/'+resolveTarget(value,client.server).id;
  const {state}=await client.request(page);
  if(!state)throw new ToolError('invalid_response','Missing page state.',1);
  return client.request(page,{method:'PATCH',unsafe:true,
   body:{expectedState:state,parent_id:resolveTarget(values.parent,client.server).id}});
 }
 if(values.alias==='')throw new ToolError('invalid_alias','Supply a nonempty alias.',2);
 const remove=sub==='site-remove';
 if(remove)requireFlags(values,['expected']);
 const body={subdomain_label:remove?value:values.alias??'',
  ...remove?{}:{folder_id:folder(value)},
  ...values.expected!==undefined?{expected_folder_id:folder(values.expected)}:{}};
 return client.request(path,{method:remove?'DELETE':'PUT',body,unsafe:true});
}

export async function workspaceList(sub,values,client){
 const roles=values.permission??[];
 for(const role of roles)enumValue(role,['viewer','commenter','editor'],'permission');
 if(values.visibility)enumValue(values.visibility,['public','unlisted','private'],'visibility');
 for(const day of [values.from,values.to])if(day!==undefined&&
  (!/^\d{4}-\d\d-\d\d$/.test(day)||!Number.isFinite(Date.parse(day))||
   new Date(day).toISOString().slice(0,10)!==day))
  throw new ToolError('invalid_date','Use a calendar date YYYY-MM-DD.',2);
 const {artifacts}=await client.request('/api/me/workspace?part='+sub);
 return {artifacts:artifacts.filter(row=>{
  const date=new Date(row.updated_at),day=[date.getFullYear(),
   String(date.getMonth()+1).padStart(2,'0'),String(date.getDate()).padStart(2,'0')].join('-');
  return (!values.owner||row.owner_username===values.owner.replace(/^@/,''))&&
   (!values.visibility||row.visibility===values.visibility)&&
   (!roles.length||roles.includes(row.role))&&(!values.from||day>=values.from)&&
   (!values.to||day<=values.to)&&(!values.search||[row.title,row.id].join(' ').toLowerCase()
    .includes(values.search.trim().toLowerCase()));
 })};
}
