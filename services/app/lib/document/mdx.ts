/** MDX is parsed as data. Rendering uses the existing static JSX validator/interpreter. */
import {unified} from 'unified';
import remarkParse from 'remark-parse';
import remarkMdx from 'remark-mdx';
import remarkGfm from 'remark-gfm';
import remarkStringify from 'remark-stringify';
import type {Root} from 'mdast';
import type {DocumentInline, DocumentJson, DocumentMark, DocumentNode, RichDocument} from '@artifactbin/contracts';
import {parseJsx} from '../jsx/parse';
import {serializeJsx} from '../jsx/serialize';
import {validateJsx} from '../jsx/validate';
import type {JsxElement, JsxNode} from '../jsx/types';
import {STORY_UI_COMPONENT_NAME_LIST} from '../story-ui/component-names';
import {assertDocument, DocumentError, normalizeInline, validNodeId} from './model';

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
function jsx(source:string):JsxNode[]{const parsed=parseJsx(source);if(!parsed.ok)throw new DocumentError(parsed.error);return parsed.nodes;}
function element(tag:string,props:Record<string,DocumentJson>,children:JsxNode[]=[]):JsxElement{return {type:'element',tag,isComponent:/^[A-Z]/.test(tag),attributes:Object.entries(props).map(([name,json])=>({name,value:{static:true as const,json},start:0,end:0})),children,selfClosing:children.length===0,start:0,end:0};}
const textNode=(value:string):JsxNode=>({type:'text',value,start:0,end:0});
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
  const id=identity?.id??fresh();d.nodes[id]=identity?{...node,props:{...node.props,...identity.props}}:node;return id;
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
    if(n.name==='Iframe'){
     const raw=source.slice(n.position?.start.offset,n.position?.end.offset);const iframe=jsx(raw)[0];
     if(iframe?.type!=='element')throw new DocumentError('Invalid iframe source');node.text=serializeJsx(iframe.children);delete node.children;
    }
    break;
   }
   case 'mdxFlowExpression':case 'mdxTextExpression':node={type:'expression',props:{},text:n.value??''};break;
   default:throw new DocumentError(`Unsupported document syntax: ${n.type}`);
  }
  const id=add(node);node=d.nodes[id]!;
  if(node.content)node.content=inline(n.children??[]);
  else if(node.children)node.children=(n.children??[]).map(block);
  if(node.name==='Flex'){node.props.direction??='row';node.props.sizes??=(node.children??[]).map(()=>1);}
  return id;
 }
 d.rootId=block(tree);
 if(identities.length&&ordinal!==identities.length)throw new DocumentError('Document metadata no longer matches its structure');
 assertDocument(d);validateDocumentMarkup(d);return d;
}
function nodeJsx(d:RichDocument,id:string):JsxNode[]{
 const n=d.nodes[id]!;
 const contents=()=>n.content?inlineJsx(d,n.content):(n.children??[]).flatMap(child=>nodeJsx(d,child));
 if(n.type==='document')return contents();
 if(n.type==='expression')return jsx(`{${n.text??''}}`);
 if(n.type==='code')return [element('pre',n.props,[element('code',{},[textNode(n.text??'')])])];
 const tag=n.type==='component'?n.name!:n.type==='html'?n.tag!:({paragraph:'p',heading:`h${n.props.depth}`,blockquote:'blockquote',list:n.props.ordered?'ol':'ul',listItem:'li',thematicBreak:'hr',table:'table',tableRow:'tr',tableCell:'td'} as Record<string,string>)[n.type];
 if(!tag)throw new DocumentError(`Cannot render ${n.type}`);
 const props={...n.props,id};
 const el=element(tag,props,n.name==='Iframe'?jsx(n.text??''):contents());
 for(const [name,binding] of Object.entries(n.bindings??{})){
  const bindingNode=jsx(`<${tag} ${name}={${binding.source}} />`)[0] as JsxElement;el.attributes.push(...bindingNode.attributes);
 }
 return [el];
}
function inlineJsx(d:RichDocument,items:DocumentInline[]):JsxNode[]{return items.flatMap(item=>{
 if(item.type==='break')return [element('br',{})];if(item.type==='nodeRef')return nodeJsx(d,item.nodeId);
 let node:JsxNode=textNode(item.text);
 for(const mark of [...item.marks].reverse())node=element(({strong:'strong',emphasis:'em',strike:'s',code:'code',link:'a',span:'span',underline:'u',sup:'sup',sub:'sub'} as Record<string,string>)[mark.type]!,mark.attrs??{},[node]);
 return [node];
});}
export function documentJsx(d:RichDocument):string{return serializeJsx(nodeJsx(d,d.rootId));}
export function validateDocumentMarkup(d:RichDocument):void {
 const errors=validateJsx(nodeJsx(d,d.rootId),{components:[...STORY_UI_COMPONENT_NAME_LIST,'Flex'],stylePolicy:'no-inline-style'});
 if(errors.length)throw new DocumentError(errors.map(e=>e.message).join('\n'));
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
    let childNodes:MdNode[];
    if(n.name==='Iframe'){
     const parsed=processor.parse(documentJsx({...d,rootId:id})) as unknown as MdNode;
     const wrapper=parsed.children?.[0];
     const iframe=wrapper?.type==='paragraph'?wrapper.children?.[0]:wrapper;
     childNodes=iframe?.children??[];
    }else childNodes=children();
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
