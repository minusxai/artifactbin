/** One ProseMirror tree owns text, layouts and component selection; no nested editor instances. */
import {Schema, type Node as PmNode, type NodeSpec, type MarkSpec, type DOMOutputSpec} from 'prosemirror-model';
import {EditorState, Plugin} from 'prosemirror-state';
import {keymap} from 'prosemirror-keymap';
import {baseKeymap, toggleMark} from 'prosemirror-commands';
import {history, undo, redo} from 'prosemirror-history';
import {splitListItem, sinkListItem, liftListItem} from 'prosemirror-schema-list';
import type {DocumentInline, DocumentJson, DocumentNode, RichDocument} from '@artifactbin/contracts';
import {assertDocument, childIds, documentValueEqual, normalizeInline} from './model';

const attrs={payload:{default:null},id:{default:null},props:{default:{}},name:{default:null},tag:{default:null},nodeType:{default:null},text:{default:null},bindings:{default:null},childIds:{default:[]}};
const fresh=()=>`n_${crypto.randomUUID().replaceAll('-','')}`;
const domAttrs=(node:PmNode)=>({'data-node-id':node.attrs.id??'',...(typeof node.attrs.props.className==='string'?{class:node.attrs.props.className}:{})});
function block(tag:string,content:string,extra:Partial<NodeSpec>={}):NodeSpec{return {attrs,group:'block',content,toDOM:n=>[tag,domAttrs(n),0],parseDOM:[{tag}],...extra};}
const mark=(tag:string):MarkSpec=>({toDOM:()=>[tag,0],parseDOM:[{tag}]});
export const documentEditorSchema=new Schema({
 nodes:{
  doc:{attrs,content:'block+'},
  paragraph:block('p','inline*'),
  heading:block('h1','inline*',{toDOM:n=>[`h${n.attrs.props.depth??1}`,domAttrs(n),0],parseDOM:[1,2,3,4,5,6].map(depth=>({tag:`h${depth}`,getAttrs:()=>({props:{depth}})}))}),
  code_block:block('pre','text*',{marks:'',code:true,defining:true,toDOM:n=>['pre',domAttrs(n),['code',0]]}),
  blockquote:block('blockquote','block+'),
  bullet_list:block('ul','list_item+'),ordered_list:block('ol','list_item+'),
  list_item:{attrs,content:'paragraph block*',defining:true,toDOM:n=>['li',domAttrs(n),0],parseDOM:[{tag:'li'}]},
  table:block('table','table_row+'),
  table_row:{attrs,content:'table_cell+',toDOM:n=>['tr',domAttrs(n),0],parseDOM:[{tag:'tr'}]},
  table_cell:{attrs,content:'inline*',toDOM:n=>['td',domAttrs(n),0],parseDOM:[{tag:'td'},{tag:'th'}]},
  thematic_break:{attrs,group:'block',toDOM:()=>['hr'],parseDOM:[{tag:'hr'}]},
  container:block('div','block*',{defining:true,draggable:true,toDOM:n=>['div',{'data-document-container':n.attrs.name??n.attrs.tag,...domAttrs(n)},0]}),
  component:{attrs,group:'block',atom:true,draggable:true,selectable:true,toDOM:n=>['div',domAttrs(n),n.attrs.name??n.attrs.tag??'Component']},
  inline_component:{attrs,group:'inline',inline:true,atom:true,draggable:true,selectable:true,toDOM:n=>['span',domAttrs(n),n.attrs.name??n.attrs.tag??'Component']},
  hard_break:{inline:true,group:'inline',selectable:false,toDOM:()=>['br'],parseDOM:[{tag:'br'}]},
  text:{group:'inline'},
 },
 marks:{
  strong:{...mark('strong'),parseDOM:[{tag:'strong'},{tag:'b'}]},emphasis:mark('em'),strike:mark('s'),code:mark('code'),underline:mark('u'),sup:mark('sup'),sub:mark('sub'),
  link:{attrs:{href:{default:''},title:{default:null}},inclusive:false,toDOM:m=>['a',m.attrs,0],parseDOM:[{tag:'a[href]',getAttrs:el=>({href:el.getAttribute('href'),title:el.getAttribute('title')})}]},
  span:{attrs:{className:{default:''}},toDOM:m=>['span',{class:m.attrs.className},0],parseDOM:[{tag:'span[class]',getAttrs:el=>({className:el.className})}]},
 },
});
function editorNode(d:RichDocument,id:string,inline=false):PmNode {
 const n=d.nodes[id]!;
 const type=n.type==='document'?'doc':n.type==='list'?(n.props.ordered?'ordered_list':'bullet_list'):({code:'code_block',listItem:'list_item',tableRow:'table_row',tableCell:'table_cell',thematicBreak:'thematic_break'} as Record<string,string>)[n.type]??(['component','html','expression'].includes(n.type)?inline?'inline_component':n.children?'container':'component':n.type);
 const payloadNodes:Record<string,DocumentNode>={};
 function collect(key:string){payloadNodes[key]=d.nodes[key];for(const child of childIds(d.nodes[key]))collect(child);}
 if(type==='inline_component'||type==='component')collect(id);
 const a={payload:Object.keys(payloadNodes).length?{rootId:id,nodes:payloadNodes}:null,id,props:n.props,name:n.name??null,tag:n.tag??null,nodeType:n.type,text:n.text??null,bindings:n.bindings??null,childIds:n.name==='Flex'?n.children??[]:[]};
 const contents=a.payload?[]:n.type==='code'?(n.text?[documentEditorSchema.text(n.text)]:[]):n.content?n.content.flatMap(item=>{
  if(item.type==='break')return [documentEditorSchema.nodes.hard_break.create()];
  if(item.type==='nodeRef')return [editorNode(d,item.nodeId,true)];
  return item.text?[documentEditorSchema.text(item.text,item.marks.map(m=>documentEditorSchema.marks[m.type].create(m.attrs)))]:[];
 }):(n.children??[]).map(c=>editorNode(d,c));
 return documentEditorSchema.nodes[type].create(a,contents);
}
export function documentEditorNode(d:RichDocument):PmNode {assertDocument(d);return editorNode(d,d.rootId);}
export function editorDocument(root:PmNode):RichDocument {
 const nodes:Record<string,DocumentNode>={};
 function visit(pm:PmNode):string {
  const id=pm.attrs.id as string;
  const type=pm.attrs.nodeType??({code_block:'code',doc:'document',bullet_list:'list',ordered_list:'list',list_item:'listItem',table_row:'tableRow',table_cell:'tableCell',thematic_break:'thematicBreak'} as Record<string,string>)[pm.type.name]??pm.type.name;
  const payload=pm.attrs.payload as {rootId:string;nodes:Record<string,DocumentNode>}|null;
  if(payload){Object.assign(nodes,structuredClone(payload.nodes));nodes[id]={...nodes[payload.rootId],props:{...pm.attrs.props},...(pm.attrs.text===null?{}:{text:pm.attrs.text})};return id;}
  const n:DocumentNode={type,props:{...pm.attrs.props}};nodes[id]=n;
  if(pm.attrs.name)n.name=pm.attrs.name;if(pm.attrs.tag)n.tag=pm.attrs.tag;if(pm.attrs.bindings)n.bindings=pm.attrs.bindings;
  if(type==='code')n.text=pm.textContent;
  else if(pm.isTextblock){
   const content:DocumentInline[]=[];
   pm.forEach(child=>{if(child.isText)content.push({type:'text',text:child.text!,marks:child.marks.map(m=>({type:m.type.name,...(Object.keys(m.attrs).length?{attrs:Object.fromEntries(Object.entries(m.attrs).filter(([,v])=>v!==null)) as Record<string,DocumentJson>}:{})}))});else if(child.type.name==='hard_break')content.push({type:'break'});else content.push({type:'nodeRef',nodeId:visit(child)});});
   n.content=normalizeInline(content);
  }else if(!pm.isAtom||pm.type.name==='doc'||pm.type.name==='container'){
   n.children=[];pm.forEach(child=>n.children!.push(visit(child)));
   if(n.name==='Flex'){
    const oldIds=pm.attrs.childIds as string[],oldSizes=n.props.sizes as number[];
    n.props.sizes=n.children.map(child=>{const i=oldIds.indexOf(child);return i<0?1:oldSizes?.[i]??1;});
   }
  }
  if(pm.attrs.text!==null&&type!=='code')n.text=pm.attrs.text;
  return id;
 }
 const rootId=visit(root);const result:RichDocument={schemaVersion:1,rootId,nodes};assertDocument(result);return result;
}
/** Splitting/pasting copies attributes; normalize duplicate identities in the same transaction group. */
const identities=new Plugin({appendTransaction(transactions,_old,state){
 if(!transactions.some(tr=>tr.docChanged))return null;
 const seen=new Set<string>([state.doc.attrs.id]);const tr=state.tr;
 state.doc.descendants((node,pos)=>{
  if(node.isText||node.type.name==='hard_break')return;
  const id=node.attrs.id as string|null;
  if(!id||seen.has(id)){
   const next=fresh();let payload=node.attrs.payload as {rootId:string;nodes:Record<string,DocumentNode>}|null;
   if(payload){
    const mapping=new Map(Object.keys(payload.nodes).map(key=>[key,key===payload!.rootId?next:fresh()]));
    const nodes:Record<string,DocumentNode>={};
    for(const [key,value] of Object.entries(payload.nodes)){
     const copy=structuredClone(value);if(copy.children)copy.children=copy.children.map(c=>mapping.get(c)!);
     if(copy.slots)copy.slots=Object.fromEntries(Object.entries(copy.slots).map(([slot,ids])=>[slot,ids.map(c=>mapping.get(c)!)]));
     if(copy.content)copy.content=copy.content.map(item=>item.type==='nodeRef'?{...item,nodeId:mapping.get(item.nodeId)!}:item);
     nodes[mapping.get(key)!]=copy;
    }payload={rootId:next,nodes};
   }
   tr.setNodeMarkup(pos,undefined,{...node.attrs,id:next,payload});seen.add(next);
  }else seen.add(id);
 });
 tr.doc.descendants((node,pos)=>{
  if(node.attrs.name!=='Flex')return;
  const ids:string[]=[];node.forEach(child=>ids.push(child.attrs.id));
  if(documentValueEqual(ids,node.attrs.childIds))return;
  const sizes=ids.map(id=>{const index=(node.attrs.childIds as string[]).indexOf(id);return index<0?1:node.attrs.props.sizes?.[index]??1;});
  tr.setNodeMarkup(pos,undefined,{...node.attrs,childIds:ids,props:{...node.attrs.props,sizes}});
 });return tr.docChanged?tr:null;
}});
export function createDocumentEditorState(d:RichDocument):EditorState {
 const s=documentEditorSchema;
 return EditorState.create({doc:documentEditorNode(d),plugins:[identities,history(),keymap({'Mod-z':undo,'Mod-Shift-z':redo,'Mod-y':redo,'Mod-b':toggleMark(s.marks.strong),'Mod-i':toggleMark(s.marks.emphasis),'Enter':splitListItem(s.nodes.list_item),'Tab':sinkListItem(s.nodes.list_item),'Shift-Tab':liftListItem(s.nodes.list_item)}),keymap(baseKeymap)]});
}
export type {DOMOutputSpec};
