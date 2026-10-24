/** Source-selected offline author adaptation. This never evaluates the recovered script. */
import {createHash} from 'node:crypto';
import {parse} from 'acorn';
import {nativeDigest} from './selection.ts';
import {rewriteNativeCss} from './resources.ts';
import type {NativeJson,RetainedJsxNode} from './analyze-contracts.ts';
import type {NativeAuthorProgramInput,NativeAuthorProgramReceipt,NativeAuthorProgramVerification,NativeBookshelfStatePlan} from './author-program-contracts.ts';
const hash=(s:string)=>createHash('sha256').update(s).digest('hex');
const escape=(s:string)=>s.replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('"','&quot;');
const json=(v:unknown)=>JSON.stringify(v).replaceAll('<','\\u003c').replaceAll('\u2028','\\u2028').replaceAll('\u2029','\\u2029');
const flatten=(nodes:readonly RetainedJsxNode[]):RetainedJsxNode[]=>nodes.flatMap(node=>[node,...node.type==='element'?flatten(node.children):[]]);
const scriptText=(node:RetainedJsxNode):string=>{if(node.type!=='element'||node.tag!=='script')throw Error('Expected ordinary source script');return node.children.map(child=>{if(child.type==='text')return child.value;if(child.type==='expression'&&child.value.static&&typeof child.value.json==='string')return child.value.json;throw Error('Nonliteral source script');}).join('');};
/** Extract ONLY the immutable literal data declaration; no source execution or expression interpretation. */
function sourceBooks(script:string):NativeBookshelfStatePlan['books']{
 const tree=parse(script,{ecmaVersion:'latest',sourceType:'module'}) as unknown as Record<string,unknown>;const arrays:unknown[]=[];
 const visit=(value:unknown)=>{if(!value||typeof value!=='object')return;if(Array.isArray(value)){value.forEach(visit);return;}const n=value as Record<string,unknown>,id=n.id as {name?:string}|undefined;if(n.type==='VariableDeclarator'&&id?.name==='books')arrays.push(n.init);Object.values(n).forEach(visit);};visit(tree);
 const literal=(value:unknown):NativeJson=>{const n=value as Record<string,unknown>;if(!n||typeof n!=='object')throw Error('Expected books literal');if(n.type==='Literal'&&(n.value===null||['string','number','boolean'].includes(typeof n.value)))return n.value as NativeJson;if(n.type==='ArrayExpression')return (n.elements as unknown[]).map(literal);if(n.type==='ObjectExpression'){const object:Record<string,NativeJson>={};for(const p of n.properties as Record<string,unknown>[]){const k=p.key as {name?:string;value?:unknown};if(p.type!=='Property'||p.computed||p.kind!=='init'||p.method||p.shorthand)throw Error('Expected books literal property');const key=k.name??k.value;if(typeof key!=='string'||Object.hasOwn(object,key)||['__proto__','constructor','prototype'].includes(key))throw Error('Invalid books literal key');object[key]=literal(p.value);}return object;}throw Error('Expected books literal');};
 if(arrays.length!==1)throw Error('Expected one books literal');const books=literal(arrays[0]);if(!Array.isArray(books)||!books.length)throw Error('Expected books literal array');const ids=new Set<string>();
 return books.map(value=>{if(!value||Array.isArray(value)||typeof value!=='object'||!['id','title','author','status','group'].every(k=>typeof value[k]==='string')||typeof value.rating!=='number'||!Number.isFinite(value.rating)||ids.has(value.id as string))throw Error('Invalid bookshelf data literal');ids.add(value.id as string);return {id:value.id as string,title:value.title as string,author:value.author as string,status:value.status as string,rating:value.rating,group:value.group as string};});
}
/** Ordinary Apollo author code, kept literal so transpiler helper closures cannot leak into pages. */
export const NATIVE_BOOKSHELF_STATE_RUNTIME=String.raw`function installBookshelfState(client,gql,plan,random=Math.random){
 let disposed=false,running=false,latest;
 const query=gql(['query NativeBookshelfLocal{'+plan.fields.join(' ')+'}']);
 const patch=data=>{
  const term=String(data.search||'').trim().toLocaleLowerCase(),filter=data.filter;
  const visible=plan.books.filter(book=>(plan.filter==='search'||filter==='all'||(filter==='favorites'?book.rating===5:book.status===filter))&&(book.title+' '+book.author).toLocaleLowerCase().includes(term));
  const ids=new Set(visible.map(book=>book.id)),next={};
  for(const book of plan.books)next['visible_'+book.id]=ids.has(book.id);
  for(const group of plan.groups)next['group_'+group]=visible.some(book=>book.group===group);
  next.empty=visible.length===0;
  if(data.surprise){next.surprise=false;if(visible.length)next['open_'+visible[Math.floor(random()*visible.length)].id]=true;}
  return Object.entries(next).some(([name,value])=>!Object.is(data[name],value))?{...data,...next}:data;
 };
 const flush=async()=>{if(running||disposed)return;running=true;try{while(latest&&!disposed){latest=undefined;await client.updateQuery({query},data=>disposed?data:patch(data));}}catch{if(!disposed)console.error('Bookshelf local state update failed');}finally{running=false;}};
 const subscription=client.watchQuery({query}).subscribe(result=>{if(disposed)return;if(result.errors?.length||!result.data)return;latest=result.data;void flush();});
 return ()=>{disposed=true;latest=undefined;subscription.unsubscribe();};
}`;
export function verifyNativeAuthorProgram({analysis,node,receipt}:NativeAuthorProgramVerification):boolean{
 const {sha256,...body}=receipt,a=receipt.admission;
 const scripts=flatten([node]).filter(n=>n.type==='element'&&n.tag==='script');
 if(node.type!=='element'||(a.profile==='ordinary-srcdoc'?node.tag!=='Iframe':node.tag!=='script')||scripts.length!==1)return false;
 try{if(hash(scriptText(scripts[0]!))!==a.scriptSha256)return false;}catch{return false;}
 return sha256===nativeDigest(body)&&nativeDigest(a.key)===nativeDigest(analysis.key)&&a.sourceSha256===analysis.sourceSha256&&a.analysisSha256===analysis.analysisSha256&&a.compilerSourceSha256===analysis.compilerSourceSha256&&a.sourceNode===node.graphKey&&a.nodeSha256===nativeDigest(node)&&['ordinary-dom-script','bookshelf-local-state','ordinary-srcdoc'].includes(a.profile)&&['search','search-and-status'].includes(a.filter)&&/^[a-f0-9]{64}$/.test(a.scriptSha256);
}
export function adaptNativeAuthorProgram(input:NativeAuthorProgramInput):NativeAuthorProgramReceipt{
 const a=input.admission,nodes=flatten(input.analysis.nodes),matches=nodes.filter(n=>n.graphKey===a.sourceNode),node=matches[0];
 if(matches.length!==1||!node||nativeDigest(a.key)!==nativeDigest(input.analysis.key)||a.sourceSha256!==input.analysis.sourceSha256||a.analysisSha256!==input.analysis.analysisSha256||a.compilerSourceSha256!==input.analysis.compilerSourceSha256||a.nodeSha256!==nativeDigest(node)||nativeDigest(input.identity.key)!==nativeDigest(a.key))throw Error('Author program source association mismatch');
 if(input.presentation){const {sha256,...body}=input.presentation;if(sha256!==nativeDigest(body)||input.presentation.sourceSha256!==a.sourceSha256||input.presentation.analysisSha256!==a.analysisSha256)throw Error('Author presentation source association mismatch');}
 const subtree=flatten([node]);const identities=subtree.map(n=>{const bs=input.identity.bindings.filter(b=>b.sourceNode===n.graphKey),b=bs[0];if(bs.length!==1||!b||b.sourceSha256!==a.sourceSha256||b.analysisSha256!==a.analysisSha256)throw Error('Author program identity association mismatch');return {sourceNode:n.graphKey,afId:b.afId,kind:n.type==='element'?'element' as const:'nonvisual' as const};});
 const scripts=subtree.filter(n=>n.type==='element'&&n.tag==='script');if(scripts.length!==1)throw Error('Expected exactly one source script');const original=scriptText(scripts[0]!);if(hash(original)!==a.scriptSha256)throw Error('Author program script association mismatch');
 let html='',authorJs='';
 if(a.profile==='ordinary-dom-script'||a.profile==='bookshelf-local-state'){
  if(node!==scripts[0]||node.type!=='element'||node.attributes.length)throw Error('Unsupported script wrapper');
  html=`<template data-af-id="${escape(identities[0]!.afId)}"></template>`;
  if(a.profile==='ordinary-dom-script')authorJs=original;
  else {
   const books=sourceBooks(original),fields=input.analysis.flow.values.map(v=>v.name),fieldSet=new Set(fields),groups=fields.filter(k=>k.startsWith('group_')).map(k=>k.slice(6));
   if(fields.some(k=>!/^[_A-Za-z][_A-Za-z0-9]*$/.test(k))||new Set(fields).size!==fields.length||!['search','surprise','empty',...(a.filter==='search-and-status'?['filter']:[]),...books.flatMap(b=>['visible_'+b.id,'open_'+b.id]),...books.map(b=>'group_'+b.group)].every(k=>fieldSet.has(k)))throw Error('Incomplete bookshelf local state declarations');
   const plan:NativeBookshelfStatePlan={fields,books,groups,filter:a.filter};
   authorJs=`import {client as bookshelfClient,gql as bookshelfGql} from "@afbin/apollo";\nconst disposeBookshelf=(${NATIVE_BOOKSHELF_STATE_RUNTIME})(bookshelfClient,bookshelfGql,${json(plan)});\ndocument.defaultView?.addEventListener('pagehide',event=>{if(!event.persisted)disposeBookshelf();});`;
  }
 }else if(a.profile==='ordinary-srcdoc'){
  if(node.type!=='element'||node.tag!=='Iframe')throw Error('Unsupported srcdoc source wrapper');
  const attributes=Object.fromEntries(node.attributes.map(v=>{if(!v.value.static)throw Error('Nonliteral iframe attribute');return [v.name,v.value.json];}));
  if(Object.keys(attributes).some(k=>!['title','height','id'].includes(k))||typeof attributes.title!=='string'||typeof attributes.height!=='number')throw Error('Unsupported iframe attributes');
  const voids=new Set(['area','base','br','col','embed','hr','img','input','link','meta','param','source','track','wbr']);
  const render=(n:RetainedJsxNode,raw?:'script'|'style'):string=>{
   if(n.type!=='element'){const value=n.type==='text'?n.value:n.value.static?n.value.json:undefined;if(typeof value!=='string'&&typeof value!=='number'&&value!==null&&typeof value!=='boolean')throw Error('Nonliteral srcdoc child');const text=value===null||typeof value==='boolean'?'':String(value);return raw?raw==='style'?rewriteNativeCss(text,input.urls??[]).css:text:escape(text);}
   if(n.isComponent||!/^([a-z][a-z0-9-]*)$/.test(n.tag)||['iframe','object','embed'].includes(n.tag))throw Error('Nonordinary srcdoc element');
   const proof=identities.find(v=>v.sourceNode===n.graphKey)!,attrs:Record<string,string|boolean>={'data-af-id':proof.afId};
   const patch=input.presentation?.resourcePatches.find(p=>p.sourceNode===n.graphKey),style=input.presentation?.inlineStyles.find(p=>p.sourceNode===n.graphKey);
   if(patch&&patch.nodeSha256!==nativeDigest(n)||style&&style.nodeSha256!==nativeDigest(n))throw Error('Srcdoc presentation node association mismatch');
   for(const attribute of n.attributes){if(!attribute.value.static||/^on/i.test(attribute.name))throw Error('Nonordinary srcdoc attribute');let name=attribute.name==='className'?'class':attribute.name==='htmlFor'?'for':attribute.name;const value=attribute.value.json;if(name==='style'){if(!style)throw Error('Missing srcdoc style receipt');attrs.style=style.css;continue;}if(value===null||value===false)continue;if(typeof value==='boolean'){attrs[name]=true;continue;}if(typeof value!=='string'&&typeof value!=='number')throw Error('Nonliteral srcdoc attribute');let text=String(value);if(['src','href','srcset','srcSet','data-cover-src'].includes(name)){if(name==='srcSet')name='srcset';const mapped=input.urls?.find(url=>url.source===text);if(mapped)text=mapped.target;else if((text.startsWith('ref:')||/^\/a\//.test(text))&&!patch?.attributes[name])throw Error('Missing srcdoc resource receipt: '+n.graphKey+':'+name);}attrs[name]=text;}
   for(const [name,value]of Object.entries(patch?.attributes??{}))attrs[name==='srcSet'?'srcset':name]=value;
   return `<${n.tag}${Object.entries(attrs).map(([name,value])=>value===true?` ${name}`:` ${name}="${escape(String(value))}"`).join('')}>${voids.has(n.tag)?'':n.children.map(child=>render(child,n.tag==='style'?'style':n.tag==='script'?'script':undefined)).join('')+`</${n.tag}>`}`;
  };
  const srcdoc='<!DOCTYPE html><html><head><meta charset="utf-8"></head><body>'+node.children.map(child=>render(child)).join('')+'</body></html>';
  html=`<iframe data-af-id="${escape(identities[0]!.afId)}"${typeof attributes.id==='string'?` id="${escape(attributes.id)}"`:''} title="${escape(attributes.title)}" height="${attributes.height}" sandbox="allow-scripts allow-popups" style="width:100%;border:0" srcdoc="${escape(srcdoc)}"></iframe>`;
 }else throw Error('Unsupported author program profile');
 const payload={admission:structuredClone(a),html,authorJs,identities};return {...payload,sha256:nativeDigest(payload)};
}
