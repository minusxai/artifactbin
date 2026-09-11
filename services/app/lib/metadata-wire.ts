import {artifactState} from './artifact-state';
import {artifactToWire,parseShareEntries,parseExpectedVersion,parseVisibilityValue,parseLinkRoleValue,parseParentField,parseAccessValue} from './artifact-wire';
import {getArtifactFor,getOwnedArtifactFor,isVersionConflict,setMetadataFor,writerFor,type TokenActor,type MetadataPatch} from './artifacts';
import {resolveParent,isParentRefusal} from './folders';
import {STORY_THEME_NAMES,STORY_TEMPLATE_NAMES} from './validation/atlas-schemas';
import {json} from './http';
export async function updateMetadataFromBody(actor:TokenActor,id:string,body:Record<string,unknown>,base:string,dryRun=false):Promise<Response>{
 const current=await getArtifactFor(actor,id);if(!current)return json({error:'not_found'},404);
 const expected=parseExpectedVersion(body,false);if(expected instanceof Response)return expected;
 if(!expected.expectedState)return json({error:'state_required',hint:'Read the artifact and send its state as expectedState.'},400);
 const allowed=new Set(['expectedState','expectedVersion','title','description','theme','template','colorMode','visibility','linkRole','parent_id','access','shares']);
 if(Object.keys(body).some(key=>!allowed.has(key)))return json({error:'invalid_metadata',allowed:[...allowed]},400);
 const governs='parent_id' in body;
 if(governs&&!await getOwnedArtifactFor(actor,id))return json({error:'owner_only'},403);
 const patch:MetadataPatch={};
 const shares=parseShareEntries(body.shares);if(shares instanceof Response)return shares;if(shares!==undefined)patch.shares=shares;
 for(const key of ['title','description','theme','template','colorMode'] as const){
  const value=body[key];if(value===undefined)continue;
  if(value!==null&&typeof value!=='string')return json({error:'invalid_metadata',field:key},400);
  if(key==='theme'&&value!==null&&!STORY_THEME_NAMES.includes(value as never))return json({error:'unknown_theme',allowed:STORY_THEME_NAMES},400);
  if(key==='template'&&value!==null&&!STORY_TEMPLATE_NAMES.includes(value as never))return json({error:'unknown_template',allowed:STORY_TEMPLATE_NAMES},400);
  if(key==='colorMode'&&value!==null&&value!=='light'&&value!=='dark')return json({error:'unknown_color_mode'},400);
  Object.assign(patch,{[key]:value});
 }
 if(body.visibility===null||body.linkRole===null)return json({error:'invalid_metadata',hint:'visibility and linkRole cannot be null.'},400);
 const visibility=parseVisibilityValue(body.visibility,!!current.user_id);if(visibility instanceof Response)return visibility;if(visibility)patch.visibility=visibility;
 const link=parseLinkRoleValue(body.linkRole);if(link instanceof Response)return link;if(link)patch.link_role=link;
 const access=parseAccessValue(body.access,current.format);if(access instanceof Response)return access;if(access)patch.access=access;
 const parent=parseParentField(body);if(parent instanceof Response)return parent;
 if(parent!==undefined){const placement=await resolveParent(writerFor(current),parent,{id,format:current.format});if(isParentRefusal(placement))return json(placement,400);patch.ancestor_ids=placement.ancestor_ids;}
 if(!Object.keys(patch).length)return json({error:'empty_metadata'},400);
 const row=await setMetadataFor(actor,id,patch,{...expected,allowEditor:!governs,dryRun});
 if(!row)return json({error:'not_found'},404);
 if(isVersionConflict(row))return json({error:row.reason??'version_conflict',currentState:row.currentState,currentVersion:row.currentVersion},409);
 return dryRun?json({valid:true,dry_run:true,state:artifactState(current),commit_checks:['authorization','observed_state']}):json(await artifactToWire(row,base));
}
