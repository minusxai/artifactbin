import {parse} from 'acorn';
import type {NativeObserverScriptPlan} from './observer-contracts.ts';
type Node={type:string;start:number;end:number;[key:string]:any};
/** Bounded read-only subset of the original `page`/Solid imports; source code is parsed, never evaluated here. */
export function adaptNativeObserverSource(source:string,declared:NativeObserverScriptPlan,identifier:string,previewIdentifier?:string):{source:string;plan:NativeObserverScriptPlan} {
 const tree=parse(source,{ecmaVersion:'latest',sourceType:'module'}) as unknown as Node;
 const imports=tree.body.filter((node:Node)=>node.type==='ImportDeclaration') as Node[],edits:{start:number;end:number;text:string}[]=[],values=new Set<string>(),queries=new Set<string>(),getters=new Set<string>(),resources=new Set<string>(),containers=new Set<string>(),functions=new Map<string,Node>();
 if(imports.length!==2||new Set(imports.map(node=>node.source.value)).size!==2)throw Error('observer_imports_unsupported');
 const imported=new Set<string>();
 for(const node of imports){const expected=node.source.value==='page'?['query','signal']:node.source.value==='solid-js'?['createEffect']:[];if(!expected.length||!node.specifiers.length||node.specifiers.length>expected.length||node.specifiers.some((specifier:Node)=>specifier.type!=='ImportSpecifier'||specifier.imported.name!==specifier.local.name||!expected.includes(specifier.local.name)||imported.has(specifier.local.name)))throw Error('observer_imports_unsupported');for(const specifier of node.specifiers)imported.add(specifier.local.name);edits.push({start:node.start,end:node.end,text:''});}
 const selected=(node:Node,names:readonly string[])=>{if(node?.type!=='Literal'||typeof node.value!=='string'||!/^\$[A-Za-z_]\w*$/.test(node.value)||!names.includes(node.value.slice(1)))throw Error('observer_binding_unsupported');return node.value.slice(1);};
 const callback=(node:Node|undefined)=>node?.type==='Identifier'?functions.get(node.name):node&&['ArrowFunctionExpression','FunctionExpression'].includes(node.type)?node:undefined;
 const returnsValue=(node:Node):boolean=>{if(!node||typeof node!=='object'||['ArrowFunctionExpression','FunctionExpression','FunctionDeclaration'].includes(node.type))return false;if(node.type==='ReturnStatement')return !!node.argument;return Object.values(node).some(value=>Array.isArray(value)?value.some(returnsValue):value&&typeof value==='object'&&returnsValue(value as Node));};
 const scriptBlobs=new Set<Node>();
 const blocked=new Set(['setTimeout','setInterval','requestAnimationFrame','queueMicrotask','fetch','eval','Function','WebSocket','XMLHttpRequest','mutation','createRoot','onCleanup','createMemo']);
 const walk=(node:Node,parent?:Node)=>{
  if(!node||typeof node!=='object'||typeof node.type!=='string')return;
  if(node.type==='VariableDeclarator'&&node.id?.type==='Identifier'&&['ArrowFunctionExpression','FunctionExpression'].includes(node.init?.type))functions.set(node.id.name,node.init);
  if(node.type==='Identifier'&&imported.has(node.name)&&parent?.type!=='ImportSpecifier'&&!(parent?.type==='CallExpression'&&parent.callee===node))throw Error('observer_import_use_unsupported');
  if(node.type==='Identifier'&&(blocked.has(node.name)||node.name===identifier||node.name===previewIdentifier))throw Error('observer_capability_unsupported');
  if(node.type==='ImportExpression'||node.type.startsWith('Export')||node.type==='AwaitExpression'||node.type==='YieldExpression'||node.type==='NewExpression'&&(node.callee?.type!=='Identifier'||node.callee.name!=='Date')&&!scriptBlobs.has(node))throw Error('observer_capability_unsupported');
  if(previewIdentifier&&node.type==='CallExpression'&&node.callee?.type==='MemberExpression'&&!node.callee.computed){
   const callee=node.callee,method=callee.property.name,owner=callee.object;
   if(owner.type==='Identifier'&&owner.name==='URL'&&method==='createObjectURL'){
    const blob=node.arguments[0],parts=blob?.arguments?.[0],options=blob?.arguments?.[1],type=options?.properties?.[0];
    if(node.arguments.length!==1||blob?.type!=='NewExpression'||blob.callee?.name!=='Blob'||blob.arguments.length!==2||parts?.type!=='ArrayExpression'||parts.elements.length!==1||parts.elements[0]?.type==='SpreadElement'||options?.type!=='ObjectExpression'||options.properties.length!==1||type?.computed||type?.kind!=='init'||(type?.key?.name??type?.key?.value)!=='type'||type?.value?.value!=='text/javascript')throw Error('observer_preview_blob_unsupported');
    scriptBlobs.add(blob);edits.push({start:node.start,end:node.end,text:previewIdentifier+'.createScriptUrl('+source.slice(parts.elements[0].start,parts.elements[0].end)+')'});
   }
   if(owner.type==='Identifier'&&owner.name==='URL'&&method==='revokeObjectURL'){if(node.arguments.length!==1)throw Error('observer_preview_blob_unsupported');edits.push({start:callee.start,end:callee.end,text:previewIdentifier+'.revokeScriptUrl'});}
   if(owner.type==='Identifier'&&owner.name==='document'&&method==='createElement'&&node.arguments[0]?.value==='iframe'){if(node.arguments.length!==1)throw Error('observer_preview_frame_unsupported');edits.push({start:node.start,end:node.end,text:previewIdentifier+'.createFrame()'});}
  }
  if(previewIdentifier&&node.type==='AssignmentExpression'&&node.left?.type==='MemberExpression'&&(node.left.computed?node.left.property.value:node.left.property.name)==='srcdoc'){
   if(node.operator!=='='||node.left.computed)throw Error('observer_preview_frame_unsupported');edits.push({start:node.start,end:node.end,text:previewIdentifier+'.setDocument('+source.slice(node.left.object.start,node.left.object.end)+','+source.slice(node.right.start,node.right.end)+')'});
  }
  if(node.type==='CallExpression'&&node.callee.type==='Identifier'){
   const name=node.callee.name;
   if(name==='signal'){if(node.arguments.length!==1||parent?.type!=='VariableDeclarator'||parent.init!==node||parent.id.type!=='ArrayPattern'||parent.id.elements.length!==1||parent.id.elements[0]?.type!=='Identifier')throw Error('observer_setter_unsupported');values.add(selected(node.arguments[0],declared.values));getters.add(parent.id.elements[0].name);}
   if(name==='query'){if(node.arguments.length!==1)throw Error('observer_query_unsupported');queries.add(selected(node.arguments[0],declared.queries));if(parent?.type==='VariableDeclarator'&&parent.id?.type==='Identifier')resources.add(parent.id.name);}
   if(name==='createEffect'){const effect=callback(node.arguments[0]);if(node.arguments.length!==1||parent?.type!=='ExpressionStatement'||!effect||effect.async||effect.generator||effect.params.length||effect.body.type!=='BlockStatement')throw Error('observer_effect_unsupported');if(returnsValue(effect.body))throw Error('observer_effect_cleanup_unsupported');}
  }
  const property=node.type==='MemberExpression'?(node.computed?node.property?.value:node.property?.name):undefined;
  if(previewIdentifier&&['sandbox','credentialless','contentWindow','contentDocument'].includes(property))throw Error('observer_preview_frame_unsupported');
  if(['ready','refetch','refresh','mutate'].includes(property))throw Error('observer_resource_capability_unsupported');
  if(node.type==='CallExpression'&&node.callee.type==='MemberExpression'){
   const callee=node.callee,method=callee.computed?callee.property?.value:callee.property?.name;
   if(method==='addEventListener'){const handler=callback(node.arguments[1]),capture=node.arguments[2];if(callee.computed||![2,3].includes(node.arguments.length)||node.arguments[0]?.type!=='Literal'||node.arguments[0].value!=='click'||!handler||handler.async||handler.generator||handler.params.length>1||handler.params.some((parameter:Node)=>parameter.type!=='Identifier')||capture&&(capture.type!=='Literal'||typeof capture.value!=='boolean'))throw Error('observer_listener_unsupported');edits.push({start:node.start,end:node.end,text:identifier+'.listen('+source.slice(callee.object.start,callee.object.end)+','+source.slice(node.arguments[0].start,node.arguments.at(-1).end)+')'});}
   if(method==='removeEventListener')throw Error('observer_listener_unsupported');
  }
  if(node.type==='AssignmentExpression'&&node.left?.type==='Identifier'&&(getters.has(node.left.name)||imported.has(node.left.name)))throw Error('observer_setter_unsupported');
  for(const [key,value]of Object.entries(node)){if(['start','end','type'].includes(key))continue;if(Array.isArray(value)){for(const child of value)if(child&&typeof child==='object')walk(child as Node,node);}else if(value&&typeof value==='object')walk(value as Node,node);}
 };
 walk(tree);
 const collect=(node:Node)=>{if(!node||typeof node!=='object')return;if(node.type==='VariableDeclarator'&&node.id?.type==='Identifier'){if(node.init?.type==='ObjectExpression'&&node.init.properties.length&&node.init.properties.every((property:Node)=>property.type==='Property'&&property.value?.type==='CallExpression'&&property.value.callee?.type==='Identifier'&&property.value.callee.name==='query'))containers.add(node.id.name);if(node.init?.type==='MemberExpression'&&node.init.object?.type==='Identifier'&&containers.has(node.init.object.name))resources.add(node.id.name);}for(const value of Object.values(node)){if(Array.isArray(value))value.forEach(child=>child&&typeof child==='object'&&collect(child));else if(value&&typeof value==='object')collect(value as Node);}};collect(tree);
 const resource=(node:Node)=>node?.type==='Identifier'&&resources.has(node.name)||node?.type==='MemberExpression'&&node.object?.type==='Identifier'&&containers.has(node.object.name);
 // Reject writes, extra resource methods, readiness promises and escaping the imported handles.
 const check=(node:Node,parent?:Node)=>{
  if(!node||typeof node!=='object')return;
  if(node.type==='CallExpression'&&((node.callee?.type==='Identifier'&&getters.has(node.callee.name)||resource(node.callee))||node.callee?.type==='MemberExpression'&&resource(node.callee.object))&&node.arguments.length)throw Error('observer_setter_unsupported');
  if(node.type==='MemberExpression'&&resource(node.object)&&(node.computed||!['loading','error'].includes(node.property?.name)))throw Error('observer_resource_capability_unsupported');
  if(node.type==='AssignmentExpression'&&(resource(node.left)||node.left?.type==='Identifier'&&getters.has(node.left.name)))throw Error('observer_setter_unsupported');
  if(node.type==='Identifier'&&resources.has(node.name)&&!(parent?.type==='VariableDeclarator'&&parent.id===node)&&!(parent?.type==='CallExpression'&&parent.callee===node)&&!(parent?.type==='MemberExpression'&&parent.object===node))throw Error('observer_resource_escape_unsupported');
  for(const value of Object.values(node)){if(Array.isArray(value))value.forEach(child=>child&&typeof child==='object'&&check(child,node));else if(value&&typeof value==='object')check(value as Node,node);}
 };check(tree);
 const ordered=edits.sort((a,b)=>b.start-a.start);for(let index=1;index<ordered.length;index++)if(ordered[index]!.end>ordered[index-1]!.start)throw Error('observer_overlapping_adaptation');
 let transformed=source;for(const edit of ordered)transformed=transformed.slice(0,edit.start)+edit.text+transformed.slice(edit.end);
 return {source:transformed,plan:{values:[...values],queries:[...queries]}};
}
