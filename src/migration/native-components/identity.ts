/** Offline graph ownership admission. Never searches text or guesses parser offsets. */
import { nativeDigest } from './selection.ts';
import type { RetainedJsxNode } from './analyze-contracts.ts';
import type { NativeIdentityRevisionInput, NativeIdentityRevision, NativeIdentityTemplate, NativeIdentityCommentTarget, NativeIdentityCommentReceipt } from './identity-contracts.ts';
const validId = (id: string) => /^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/.test(id);
export function bindNativeIdentities(inputs: readonly NativeIdentityRevisionInput[]): NativeIdentityRevision[] {
 const owners = new Map<string,string>(), ids = new Map<string,string>(), retired = new Set<string>();
 let previous = new Set<string>(), lastVersion = 0, page: string | undefined;
 return inputs.map(({graph,typed}) => {
  const pageKey=nativeDigest([graph.key.sourceNamespace,graph.key.sourceId]);
  if(page!==undefined&&page!==pageKey)throw Error('native_identity_page');
  page=pageKey;
  if(graph.key.version<=lastVersion||!Number.isSafeInteger(graph.key.version))throw Error('native_identity_version_order');
  lastVersion=graph.key.version;
  if(nativeDigest(typed.key)!==nativeDigest(graph.key)||typed.analysisSha256!==nativeDigest(graph)||typed.documentSha256!==graph.documentSha256||typed.sourceSha256!==graph.sourceSha256)throw Error('native_identity_analysis');
  const graphNodes=new Map(graph.identities.map(n=>[n.sourceNode,n]));
  if(graphNodes.size!==graph.identities.length)throw Error('native_identity_graph_mapping');
  const sourceSpans=new Map(typed.sourceSpans.map(n=>[n.sourceNode,n]));
  if(sourceSpans.size!==typed.sourceSpans.length||sourceSpans.size!==graphNodes.size)throw Error('native_identity_span');
  for(const [key,n] of graphNodes){const span=sourceSpans.get(key);if(!span||span.sourceStart!==n.sourceStart||span.sourceEnd!==n.sourceEnd||!Number.isSafeInteger(n.sourceStart)||!Number.isSafeInteger(n.sourceEnd)||n.sourceStart<0||n.sourceEnd<n.sourceStart||n.sourceEnd>graph.source.length)throw Error('native_identity_span');}
  const current=new Set<string>(),bindings:NativeIdentityTemplate[]=[];
  const visit=(node:RetainedJsxNode,parent:string):void=>{
   const original=graphNodes.get(node.graphKey);
   if(!original||original.parent!==parent||current.has(node.graphKey)||node.graphKey==='$root')throw Error('native_identity_graph_mapping');
   if(retired.has(node.graphKey))throw Error('native_identity_reintroduced');
   current.add(node.graphKey);
   const attribute=(name:string):string|undefined=>{
    if(node.type!=='element')return;
    const attrs=node.attributes.filter(a=>a.name===name);
    if(attrs.length>1)throw Error('native_identity_attribute_ambiguous');
    const value=attrs[0]?.value;
    if(value&&(!value.static||typeof value.json!=='string'))throw Error('native_identity_dynamic_id');
    return value?.static?value.json as string:undefined;
   };
   const authored=attribute('data-af-id');
   const afId=authored??`n_${nativeDigest([pageKey,node.graphKey])}`;
   if(!validId(afId))throw Error('native_identity_invalid_id');
   if(owners.has(node.graphKey)&&owners.get(node.graphKey)!==afId)throw Error('native_identity_changed');
   if(ids.has(afId)&&ids.get(afId)!==node.graphKey)throw Error('native_identity_collision');
   owners.set(node.graphKey,afId);ids.set(afId,node.graphKey);
   const kind:NativeIdentityTemplate['kind']=node.type==='element'?(node.tag==='For'?'loop':node.control?'condition':'element'):node.type;
   const receipt={sourceNode:node.graphKey,sourceStart:original.sourceStart,sourceEnd:original.sourceEnd,sourceSha256:graph.sourceSha256,analysisSha256:typed.analysisSha256,afId,kind,owner:node.graphKey,authoredDomId:attribute('id')};
   bindings.push({...receipt,proofSha256:nativeDigest({key:graph.key,graphIdentity:original,...receipt})});
   const children=node.type==='element'?node.children:[];
   if(nativeDigest(children.map(n=>n.graphKey))!==nativeDigest(original.children))throw Error('native_identity_graph_mapping');
   children.forEach(child=>visit(child,node.graphKey));
  };
  const root=graphNodes.get('$root');
  if(!root||root.parent!==null||nativeDigest(root.children)!==nativeDigest(typed.nodes.map(n=>n.graphKey)))throw Error('native_identity_graph_mapping');
  typed.nodes.forEach(node=>visit(node,'$root'));
  if(current.size!==graphNodes.size-1)throw Error('native_identity_graph_mapping');
  for(const old of previous)if(!current.has(old))retired.add(old);
  previous=current;
  const reservedIdentities=[...ids].map(([afId,sourceNode])=>({afId,sourceNode})).sort((a,b)=>a.afId.localeCompare(b.afId));
  const receipt={key:{...graph.key},bindings,reservedIdentities};
  return {...receipt,proofSha256:nativeDigest(receipt)};
 });
}
export function resolveNativeIdentityComment(revisions:readonly NativeIdentityRevision[],input:NativeIdentityCommentTarget):NativeIdentityCommentReceipt {
 const versions=revisions.filter(r=>nativeDigest(r.key)===nativeDigest(input.key));
 if(versions.length!==1)throw Error('native_identity_comment_version');
 const revision=versions[0]!;
 if(nativeDigest({key:revision.key,bindings:revision.bindings,reservedIdentities:revision.reservedIdentities})!==revision.proofSha256)throw Error('native_identity_comment_proof');
 const matches=revision.bindings.filter(b=>input.target.kind==='graph'?b.sourceNode===input.target.value:b.authoredDomId===input.target.value);
 if(matches.length!==1)throw Error('native_identity_comment_target');
 const binding=matches[0]!;
 return {key:{...input.key},sourceNode:binding.sourceNode,afId:binding.afId,templateKind:binding.kind,proofSha256:nativeDigest({revisionProof:revision.proofSha256,target:input.target,bindingProof:binding.proofSha256})};
}
