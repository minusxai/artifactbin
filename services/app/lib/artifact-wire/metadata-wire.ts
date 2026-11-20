import {artifactToWire,committedOpenAnnotations,parseShareEntries,parseSharingRevision,parseExpectedVersion,parseVisibilityValue,parseLinkRoleValue,parseParentField,parseAccessValue} from './wire';
import { artifactState, getArtifactFor, getOwnedArtifactFor, isParentRefusal, isVersionConflict, resolveParent, setMetadataFor, type MetadataPatch } from '@/lib/artifacts';
import { writerFor } from '@/lib/artifact-access';
import { shareTargetsRefusal, TEST_ACCOUNT_RESTRICTED, type AccessActor } from '@/lib/accounts';
import {STORY_DESIGN_NAMES,STORY_TEMPLATE_NAMES} from '@/lib/validation';
import {Reply,reply} from '@/lib/http';
import {htmlSystemNames,isHtmlSystem} from '@/lib/html-systems';
import {validateDatasetPolicyForRow} from '@/lib/datasets';
export async function updateMetadataFromBody(actor:AccessActor,id:string,body:Record<string,unknown>,base:string,dryRun=false):Promise<Reply>{
 if(['document_update','markup','jsx','markdown','source','operations','annotation_ops','edit_id','old_string','new_string'].some(key=>Object.hasOwn(body,key)))return reply({error:'native_html_required',hint:'Replace page content with the complete html field and observed expectedVersion/expectedState through PUT. Metadata PATCH accepts metadata fields only.'},400);
 const current=await getArtifactFor(actor,id);if(!current)return reply({error:'not_found'},404);
 const expected=parseExpectedVersion(body,false);if(expected instanceof Reply)return expected;
 if(!expected.expectedState)return reply({error:'state_required',hint:'Read the artifact and send its state as expectedState.'},400);
 const allowed=new Set(['expectedState','expectedVersion','expectedPolicyRevision','policy','expectedSharingRevision','title','description','theme','template','colorMode','visibility','linkRole','parent_id','access','shares']);
 if(Object.keys(body).some(key=>!allowed.has(key)))return reply({error:'invalid_metadata',allowed:[...allowed]},400);
 const governs='parent_id' in body;
 if(governs&&!await getOwnedArtifactFor(actor,id))return reply({error:'owner_only'},403);
 const patch:MetadataPatch={};
 if(Object.hasOwn(body,'policy')){
  if(!Number.isSafeInteger(body.expectedPolicyRevision)||Number(body.expectedPolicyRevision)<0)return reply({error:'policy_revision_required'},400);
  try{patch.policy=validateDatasetPolicyForRow(current,body.policy);}catch(error){return reply({error:'invalid_policy',detail:error instanceof Error?error.message:'Invalid policy'},400);}
 }else if(body.expectedPolicyRevision!==undefined)return reply({error:'invalid_metadata',field:'expectedPolicyRevision'},400);
 const shares=parseShareEntries(body.shares);if(shares instanceof Reply)return shares;const boxed=await shareTargetsRefusal(actor,shares);if(boxed)return reply({error:TEST_ACCOUNT_RESTRICTED,detail:boxed},403);if(shares!==undefined)patch.shares=shares;
 for(const key of ['title','description','theme','template','colorMode'] as const){
  const value=body[key];if(value===undefined)continue;
  if(value!==null&&typeof value!=='string')return reply({error:'invalid_metadata',field:key},400);
  // An HTML page's theme is its owner's design-system choice: one of the systems the platform stylesheet carries, or null.
  if(key==='theme'&&value!==null&&current.format==='html'&&!isHtmlSystem(value))return reply({error:'unknown_theme',allowed:htmlSystemNames()},400);
  if(key==='theme'&&value!==null&&current.format!=='html'&&!STORY_DESIGN_NAMES.includes(value as never))return reply({error:'unknown_theme',allowed:STORY_DESIGN_NAMES},400);
  if(key==='template'&&value!==null&&!STORY_TEMPLATE_NAMES.includes(value as never))return reply({error:'unknown_template',allowed:STORY_TEMPLATE_NAMES},400);
  if(key==='colorMode'&&value!==null&&value!=='light'&&value!=='dark')return reply({error:'unknown_color_mode'},400);
  Object.assign(patch,{[key]:value});
 }
 if(body.visibility===null||body.linkRole===null)return reply({error:'invalid_metadata',hint:'visibility and linkRole cannot be null.'},400);
 const visibility=parseVisibilityValue(body.visibility,!!(current.user_id||current.group_id));if(visibility instanceof Reply)return visibility;if(visibility)patch.visibility=visibility;
 const link=parseLinkRoleValue(body.linkRole);if(link instanceof Reply)return link;if(link)patch.link_role=link;
 const access=parseAccessValue(body.access,current.format);if(access instanceof Reply)return access;if(access)patch.access=access;
 const expectedSharingRevision=parseSharingRevision(body);if(expectedSharingRevision instanceof Reply)return expectedSharingRevision;
 const parent=parseParentField(body);if(parent instanceof Reply)return parent;
 if(parent!==undefined){const placement=await resolveParent(writerFor(current),parent,{id,format:current.format});if(isParentRefusal(placement))return reply(placement,400);patch.ancestor_ids=placement.ancestor_ids;}
 if(!Object.keys(patch).length)return reply({error:'empty_metadata'},400);
 const row=await setMetadataFor(actor,id,patch,{...expected,expectedPolicyRevision:body.expectedPolicyRevision as number|undefined,expectedSharingRevision,allowEditor:!governs,dryRun});
 if(!row)return reply({error:'not_found'},404);
 if(isVersionConflict(row)){const {conflict:_conflict,...conflict}=row;return reply(conflict,409);}
 return dryRun?reply({valid:true,dry_run:true,state:artifactState(current),commit_checks:['authorization','observed_state']}):reply(await artifactToWire(row,base,committedOpenAnnotations(row)));
}
