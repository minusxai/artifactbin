/** MDX is parsed as data. Rendering uses the existing static JSX validator/interpreter. */
import {unified} from 'unified';
import remarkParse from 'remark-parse';
import remarkMdx from 'remark-mdx';
import remarkGfm from 'remark-gfm';
import remarkStringify from 'remark-stringify';
import type {Root} from 'mdast';
import type {DocumentInline, DocumentJson, DocumentMark, DocumentNode, RichDocument} from '@artifactbin/contracts';
import {validateDocumentMarkup,documentElement as element,parseDocumentJsx as jsx} from './markup';
export {documentJsx,validateDocumentMarkup} from './markup';
import {serializeJsx} from '../jsx/serialize';
import type {JsxElement} from '../jsx/types';
import {assertDocument, childIds, DocumentError, normalizeInline, validNodeId} from './model';

interface MdNode {
 type:string; value?:string; name?:string; children?:MdNode[];
 depth?:number; ordered?:boolean; start?:number|null; checked?:boolean|null;
 lang?:string|null; meta?:string|null; url?:string; title?:string|null; alt?:string|null;
 align?:Array<'left'|'right'|'center'|null>;
 attributes?:Array<{type:string;name?:string;value?:string|null|{type:string;value:string}}>;
 position?:{start:{offset?:number};end:{offset?:number}};
}
interface Identity {id:string;type:string;props:Record<string,DocumentJson>}
const processor=unified().use(remarkParse).use(remarkMdx).use(remarkGfm).use(remarkStringify);
const fresh=()=>`n_${crypto.randomUUID().replaceAll('-','')}`;
function attributeSource(n:MdNode):string {
 return (n.attributes??[]).map(a=>{
  if(a.type!=='mdxJsxAttribute'||!a.name)throw new DocumentError('Spread attributes are not document data');
  return a.value===null||a.value===undefined?a.name:typeof a.value==='string'?`${a.name}={${JSON.stringify(a.value)}}`:`${a.name}={${a.value.value}}`;
 }).join(' ');
}
/** Source metadata preserves stable identity and non-Markdown properties; it is never executed. */
export function parseDocumentMdx(source:string):RichDocument {
 const tree=processor.parse(source) as unknown as MdNode;
 let identities:Identity[]=[];
 const first=tree.children?.[0];
 if(first?.type==='mdxFlowExpression'&&first.value?.trim().startsWith('/* @afbin-document ')){
  try{identities=JSON.parse(first.value.trim().slice('/* @afbin-document '.length,-2).trim()) as Identity[];}catch{throw new DocumentError('Invalid document metadata');}
  if(!Array.isArray(identities)||identities.length>20000)throw new DocumentError('Invalid document metadata');
  tree.children!.shift();
 }
 const d:RichDocument={schemaVersion:1,rootId:'',nodes:{}};let ordinal=0;
 function add(node:DocumentNode):string {
  const identity=identities[ordinal++];
  if(identity&&(!validNodeId(identity.id)||identity.type!==node.type||Object.hasOwn(d.nodes,identity.id)))throw new DocumentError('Document metadata no longer matches its structure');
  const id=identity?.id??fresh();d.nodes[id]=identity?{...node,props:['component','html'].includes(node.type)?node.props:identity.props}:node;return id;
 }
 function inline(nodes:MdNode[],marks:DocumentMark[]=[]):DocumentInline[]{return normalizeInline(nodes.flatMap((n):DocumentInline[]=>{
  if(n.type==='text')return [{type:'text',text:n.value??'',marks}];
  if(n.type==='break')return [{type:'break'}];
  if(['strong','emphasis','delete','inlineCode','link'].includes(n.type)){
   const mark:DocumentMark={type:n.type==='delete'?'strike':n.type==='inlineCode'?'code':n.type};
   if(n.type==='link')mark.attrs={href:n.url??'',...(n.title?{title:n.title}:{})};
   return inline(n.type==='inlineCode'?[{type:'text',value:n.value}]:n.children??[],[...marks,mark]);
  }
  if(n.type==='mdxJsxTextElement'&&['span','u','sup','sub'].includes(n.name??'')){
   const parsed=jsx(`<${n.name} ${attributeSource(n)} />`)[0] as JsxElement;
   const attrs:Record<string,DocumentJson>={};for(const a of parsed.attributes){if(!a.value.static)throw new DocumentError('Text styling must be literal data');attrs[a.name]=a.value.json;}
   return inline(n.children??[],[...marks,{type:n.name==='u'?'underline':n.name!,attrs}]);
  }
  return [{type:'nodeRef',nodeId:block(n)}];
 }));}
 function block(n:MdNode):string {
  const only=n.children?.[0];
  if(n.type==='paragraph'&&n.children?.length===1&&only?.type==='mdxJsxTextElement'&&!['span','u','sup','sub','a','em','strong','code'].includes(only.name??''))return block({...only,type:'mdxJsxFlowElement'});
  let node:DocumentNode;
  switch(n.type){
   case 'root':node={type:'document',props:{},children:[]};break;
   case 'paragraph':case 'heading':node={type:n.type,props:n.type==='heading'?{depth:n.depth??1}:{},content:[]};break;
   case 'code':node={type:'code',props:{lang:n.lang??'',meta:n.meta??''},text:n.value??''};break;
   case 'blockquote':case 'listItem':case 'tableRow':node={type:n.type,props:n.type==='listItem'&&n.checked!=null?{checked:n.checked}:{},children:[]};break;
   case 'list':node={type:'list',props:{ordered:n.ordered??false,start:n.start??1},children:[]};break;
   case 'table':node={type:'table',props:{align:n.align??[]},children:[]};break;
   case 'tableCell':node={type:'tableCell',props:{},content:[]};break;
   case 'thematicBreak':node={type:'thematicBreak',props:{}};break;
   case 'image':node={type:'html',tag:'img',props:{src:n.url??'',alt:n.alt??'',...(n.title?{title:n.title}:{})}};break;
   case 'mdxJsxFlowElement':case 'mdxJsxTextElement':{
    if(!n.name)throw new DocumentError('Use a named container instead of a JSX fragment');
    const el=jsx(`<${n.name} ${attributeSource(n)} />`)[0] as JsxElement;
    node={type:el.isComponent?'component':'html',...(el.isComponent?{name:el.tag}:{tag:el.tag}),props:{},children:[]};
    for(const a of el.attributes){if(a.value.static)node.props[a.name]=a.value.json;else(node.bindings??={})[a.name]={source:a.value.source,scope:'reactive'};}
    if(!n.children?.length&&!['Flex','div','section','article'].includes(n.name))delete node.children;
    if(n.type==='mdxJsxTextElement'){node.content=[];delete node.children;}
    if(n.name==='Iframe'||n.name==='Helmet'){
     const raw=source.slice(n.position?.start.offset,n.position?.end.offset);const iframe=jsx(raw)[0];
     if(iframe?.type!=='element')throw new DocumentError('Invalid iframe source');node.text=serializeJsx(iframe.children);delete node.children;delete node.content;
    }
    break;
   }
   case 'mdxFlowExpression':case 'mdxTextExpression':node={type:'expression',props:{},text:n.value??''};break;
   default:throw new DocumentError(`Unsupported document syntax: ${n.type}`);
  }
  const id=add(node);node=d.nodes[id]!;
  if(node.content)node.content=inline(n.children??[]);
  else if(node.children){
   const children:MdNode[]=[];let run:MdNode[]=[];
   const flush=()=>{if(run.length){children.push({type:'paragraph',children:run});run=[];}};
   for(const child of n.children??[]){if(['text','strong','emphasis','delete','inlineCode','link','image','break','mdxJsxTextElement','mdxTextExpression'].includes(child.type))run.push(child);else{flush();children.push(child);}}
   flush();node.children=children.map(block);
  }
  if(node.name==='Flex'){node.props.direction??='row';node.props.sizes??=(node.children??[]).map(()=>1);}
  return id;
 }
 if(!tree.children?.length)tree.children=[{type:'paragraph',children:[]}];
 d.rootId=block(tree);
 if(identities.length&&ordinal!==identities.length)throw new DocumentError('Document metadata no longer matches its structure');
 assertDocument(d);validateDocumentMarkup(d);return d;
}
export function serializeDocumentMdx(d:RichDocument,includeIdentity=true):string {
 assertDocument(d);validateDocumentMarkup(d);
 const identities:Identity[]=[];
 function inline(items:DocumentInline[]):MdNode[]{return items.map(item=>{
  if(item.type==='break')return {type:'break'};
  if(item.type==='nodeRef'){const node=block(item.nodeId);if(node.type==='mdxJsxFlowElement')node.type='mdxJsxTextElement';if(node.type==='mdxFlowExpression')node.type='mdxTextExpression';return node;}
  let node:MdNode={type:'text',value:item.text};
  for(const mark of [...item.marks].reverse()){
   if(mark.type==='code'){node={type:'inlineCode',value:item.text};continue;}
   if(['strong','emphasis','strike','link'].includes(mark.type)){node={type:mark.type==='strike'?'delete':mark.type,children:[node],...(mark.type==='link'?{url:String(mark.attrs?.href??''),title:mark.attrs?.title?String(mark.attrs.title):null}:{})};}
   else node={type:'mdxJsxTextElement',name:mark.type==='underline'?'u':mark.type,attributes:attributes(mark.attrs??{}),children:[node]};
  }
  return node;
 });}
 function attributes(props:Record<string,DocumentJson>):NonNullable<MdNode['attributes']>{return Object.entries(props).map(([name,value])=>({type:'mdxJsxAttribute',name,value:typeof value==='string'?value:{type:'mdxJsxAttributeValueExpression',value:JSON.stringify(value)}}));}
 function block(id:string):MdNode {
  const n=d.nodes[id]!;identities.push({id,type:n.type,props:n.type==='component'||n.type==='html'?{}:n.props});
  const children=()=>n.content?inline(n.content):(n.children??[]).map(block);
  switch(n.type){
   case 'document':return {type:'root',children:children()};
   case 'paragraph':case 'blockquote':case 'tableRow':case 'tableCell':return {type:n.type,children:children()};
   case 'heading':return {type:'heading',depth:Number(n.props.depth),children:children()};
   case 'list':return {type:'list',ordered:!!n.props.ordered,start:Number(n.props.start??1),children:children()};
   case 'listItem':return {type:'listItem',checked:typeof n.props.checked==='boolean'?n.props.checked:null,children:children()};
   case 'table':return {type:'table',align:n.props.align as MdNode['align'],children:children()};
   case 'code':return {type:'code',lang:String(n.props.lang??''),meta:String(n.props.meta??''),value:n.text??''};
   case 'thematicBreak':return {type:'thematicBreak'};
   case 'expression':return {type:'mdxFlowExpression',value:n.text??''};
   case 'component':case 'html':{
    if(n.name==='Iframe'||n.name==='Helmet')return {type:'html',value:serializeJsx([element(n.name,n.props,jsx(n.text??''))])};
    const childNodes=children();
    return {type:'mdxJsxFlowElement',name:n.name??n.tag,attributes:[...attributes(n.props),...Object.entries(n.bindings??{}).map(([name,b])=>({type:'mdxJsxAttribute',name,value:{type:'mdxJsxAttributeValueExpression',value:b.source}}))],children:childNodes};
   }
   default:throw new DocumentError(`Cannot export ${n.type}`);
  }
 }
 const tree=block(d.rootId);
 const metadata=JSON.stringify(identities).replaceAll('*/','*\\u002f');
 if(includeIdentity)tree.children!.unshift({type:'mdxFlowExpression',value:`/* @afbin-document ${metadata} */`});
 return processor.stringify(tree as unknown as Root);
}

/** Reconcile source edits against the open draft. Unchanged siblings anchor identity;
 * same-shaped gaps retain identity on text edits. New blocks receive new IDs.
 * Markdown-owned properties come from source; visual prose properties stay on the node.
 */
export function reparseDocumentMdx(previous:RichDocument,source:string):RichDocument {
 const next=parseDocumentMdx(source),mapping=new Map<string,string>();
 const compatible=(a:DocumentNode,b:DocumentNode)=>a.type===b.type&&a.name===b.name&&a.tag===b.tag;
 const signature=(n:DocumentNode)=>JSON.stringify([n.type,n.name,n.tag,n.text,n.content?.map(c=>c.type==='nodeRef'?{type:c.type}:c)]);
 function match(oldId:string,newId:string){
  const old=previous.nodes[oldId],node=next.nodes[newId];if(!compatible(old,node))return;
  mapping.set(newId,oldId);
  if(!['component','html'].includes(node.type)){
   const visual=Object.fromEntries(Object.entries(old.props).filter(([key])=>!['depth','ordered','start','checked','align','lang','meta'].includes(key)));
   node.props={...visual,...node.props};
  }
  const before=childIds(old),after=childIds(node),positions=new Map<string,number[]>();
  before.forEach((id,index)=>{const key=signature(previous.nodes[id]);positions.set(key,[...(positions.get(key)??[]),index]);});
  const anchors:Array<[number,number]>=[];let cursor=0;
  after.forEach((id,index)=>{const candidates=positions.get(signature(next.nodes[id]));while(candidates?.length&&candidates[0]<cursor)candidates.shift();const pos=candidates?.shift();if(pos!==undefined){anchors.push([pos,index]);cursor=pos+1;}});
  anchors.push([before.length,after.length]);let a=0,b=0;
  for(const [i,j] of anchors){
   if(i-a===j-b)for(let k=0;k<i-a;k++)match(before[a+k],after[b+k]);
   if(i<before.length)match(before[i],after[j]);a=i+1;b=j+1;
  }
 }
 match(previous.rootId,next.rootId);
 const remap=(id:string)=>mapping.get(id)??id;
 next.nodes=Object.fromEntries(Object.entries(next.nodes).map(([id,node])=>[remap(id),{...node,...(node.children?{children:node.children.map(remap)}:{}),...(node.slots?{slots:Object.fromEntries(Object.entries(node.slots).map(([key,ids])=>[key,ids.map(remap)]))}:{}),...(node.content?{content:node.content.map(c=>c.type==='nodeRef'?{...c,nodeId:remap(c.nodeId)}:c)}:{})}]));
 next.rootId=remap(next.rootId);assertDocument(next);validateDocumentMarkup(next);return next;
}
