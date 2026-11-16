/** Structural editor actions preserve complete sibling subtrees and local selections. */
import type { Editor } from '@tiptap/core';
import { Fragment } from 'prosemirror-model';
import { TextSelection } from 'prosemirror-state';
import { ySyncPluginKey, yUndoPluginKey } from '@tiptap/y-tiptap';
import * as Y from 'yjs';
export function isolated(editor:Editor,action:()=>boolean):boolean {
 const undo=yUndoPluginKey.getState(editor.state)?.undoManager;
 undo?.stopCapturing();try{return action();}finally{undo?.stopCapturing();}
}
export function toggleCheck(editor:Editor):boolean {
 const {$from}=editor.state.selection;
 for(let d=$from.depth;d>0;d--){const node=$from.node(d);if(node.type.name==='taskItem'){
  editor.view.dispatch(editor.state.tr.setNodeMarkup($from.before(d),undefined,{...node.attrs,checked:!node.attrs.checked}));return true;
 }}return false;
}
export function moveSibling(editor:Editor,down:boolean):boolean {
 const {state}=editor,{selection}=state,{$from,$to}=selection;
 let depth=1;
 for(let d=$from.depth;d>0;d--)if(['listItem','taskItem'].includes($from.node(d).type.name)){depth=d;break;}
 if($to.depth<depth||$from.node(depth-1)!==$to.node(depth-1))return true;
 const parent=$from.node(depth-1),first=$from.index(depth-1),last=$to.index(depth-1);
 if(down?last===parent.childCount-1:first===0)return true;
 const start=$from.before(depth),end=$to.after(depth),neighbor=parent.child(down?last+1:first-1);
 const from=down?start:start-neighbor.nodeSize,to=down?end+neighbor.nodeSize:end;
 const delta=down?neighbor.nodeSize:-neighbor.nodeSize;
 const map=(pos:number)=>pos<from||pos>=to?pos:down?(pos<end?pos+neighbor.nodeSize:pos-(end-start)):(pos<start?pos+(end-start):pos-neighbor.nodeSize);
 return structural(editor,()=>{
  // Equal anonymous siblings otherwise produce an identical document, so the
  // reconciliation layer cannot represent which logical sibling moved. Give
  // only this action's textblocks identities in the same undo group.
  let tr=editor.state.tr;
  editor.state.doc.nodesBetween(from,to,(node,pos)=>{if(node.isTextblock&&!node.attrs.afId)tr.setNodeMarkup(pos,undefined,{...node.attrs,afId:`af-${Array.from(crypto.getRandomValues(new Uint8Array(16)),byte=>byte.toString(16).padStart(2,'0')).join('')}`});});
  editor.view.dispatch(tr);
  tr=editor.state.tr;
  const nodes:import('prosemirror-model').Node[]=[];
  const current=editor.state.selection.$from.node(depth-1);
  for(let i=down?first:first-1;i<=(down?last+1:last);i++)nodes.push(current.child(i));
  const moved=down?[nodes.at(-1)!,...nodes.slice(0,-1)]:[...nodes.slice(1),nodes[0]!];
  tr.replaceWith(from,to,Fragment.fromArray(moved));
  tr.setSelection(TextSelection.create(tr.doc,selection.anchor+delta,selection.head+delta));editor.view.dispatch(tr.scrollIntoView());return true;
 },map);
}
/** Only explicit semantic checkboxes qualify; ordinary lists and prose remain untouched. */
export function normalizeChecklist(html:string,document:Document):string {
 const host=document.createElement('div');host.innerHTML=html;
 for(const list of Array.from(host.querySelectorAll('ul,ol')).reverse()){
  const items=Array.from(list.children).filter(el=>el.tagName==='LI');
  const checked=(item:Element)=>{
   const input=Array.from(item.querySelectorAll('input[type="checkbox"],[role="checkbox"]')).find(el=>el.closest('li')===item);
   if(item.getAttribute('role')==='checkbox')return item.getAttribute('aria-checked')==='true';
   if(input)return input.hasAttribute('checked')||input.getAttribute('aria-checked')==='true';
   if(item.classList.contains('task-list-item'))return item.getAttribute('data-checked')==='true';
   return null;
  };
  if(!items.some(item=>checked(item)!==null))continue;
  // Split mixed lists into consecutive homogeneous runs without flattening nested lists.
  let run:Element|undefined,task:boolean|undefined;
  for(const item of items){const value=checked(item),next=value!==null;
   if(next!==task){run=document.createElement(next?'ul':list.tagName.toLowerCase());if(next)run.setAttribute('data-type','taskList');else for(const attr of Array.from(list.attributes))run.setAttribute(attr.name,attr.value);list.before(run);task=next;}
   if(next){item.setAttribute('data-type','taskItem');item.setAttribute('data-checked',String(value));item.removeAttribute('role');item.removeAttribute('aria-checked');for(const input of Array.from(item.querySelectorAll('input[type="checkbox"],[role="checkbox"]')))if(input.closest('li')===item){if(input.tagName==='INPUT')input.remove();else input.replaceWith(...Array.from(input.childNodes));}}
   run!.append(item);
  }list.remove();
 }return host.innerHTML;
}

const STRUCTURE=Symbol('native-structural-content');
type Block={pos:number;node:import('prosemirror-model').Node;anchor:Y.RelativePosition};
function blocks(editor:Editor):Block[]{
 const sync=ySyncPluginKey.getState(editor.state)!,result:Block[]=[];
 // Binding mappings may reuse one ProseMirror object for equal XML siblings.
 // Walk XML order against the current document instead of reversing that map.
 const visit=(parent:Y.XmlFragment,start:number)=>{
  let pos=start;
  for(const type of parent.toArray()){
   if(!(type instanceof Y.XmlElement))continue;
   const node=editor.state.doc.nodeAt(pos);
   if(!node)return;
   if(node.isTextblock)result.push({node,pos,anchor:Y.createRelativePositionFromTypeIndex(type,0,-1)});
   else visit(type,pos+1);
   pos+=node.nodeSize;
  }
 };
 visit(sync.type,0);return result;
}
type Pair={before:Block;after:Block};
/** Structural commands provide a bijection of their block positions. The default
 * is for node-kind changes, which preserve positions; moves supply their exact
 * permutation. Only replaced Yjs shells need preservation. Relative type anchors
 * follow Yjs undo resurrection and peer insertions, never text or old offsets. */
export function structural(editor:Editor,action:()=>boolean,map:(pos:number)=>number=pos=>pos):boolean {
 const before=blocks(editor),done=isolated(editor,action),after=blocks(editor);
 const pairs:Pair[]=[];
 for(const old of before){
  const next=after.find(block=>block.pos===map(old.pos));
  if(next&&!Y.compareRelativePositions(old.anchor,next.anchor))pairs.push({before:old,after:next});
 }
 const undo=yUndoPluginKey.getState(editor.state)?.undoManager;
 if(done&&pairs.length&&undo?.undoStack.length)undo.undoStack.at(-1)!.meta.set(STRUCTURE,pairs);
 return done;
}
function liveBlock(editor:Editor,block:Block):Block|undefined {
 const sync=ySyncPluginKey.getState(editor.state)!;
 const resolved=Y.createAbsolutePositionFromRelativePosition(block.anchor,sync.doc);
 if(!resolved||resolved.type._item?.deleted)return;
 if(!(resolved.type instanceof Y.XmlElement))return;
 const anchor=Y.createRelativePositionFromTypeIndex(resolved.type,0,-1);
 return blocks(editor).find(candidate=>Y.compareRelativePositions(candidate.anchor,anchor));
}
export function undoNative(editor:Editor,redo=false):boolean {
 const undo=yUndoPluginKey.getState(editor.state)?.undoManager;
 const item=(redo?undo?.redoStack:undo?.undoStack)?.at(-1);
 const pairs=item?.meta.get(STRUCTURE) as Pair[]|undefined;
 // A peer may replace/move a shell itself. There is no Yjs resurrection link
 // from that peer replacement to this action. Refuse this undo without popping
 // history rather than restore a duplicate or guess at a different block.
 if(pairs?.some(pair=>!liveBlock(editor,redo?pair.before:pair.after)))return false;
 // Capture every replaced/mapped block, even unchanged content: reconciliation
 // can reuse XML shells positionally for equal siblings. Undo then leaves peer
 // text in the old slot, which the inverse permutation must restore as well.
 const edits=pairs?.flatMap(pair=>{
  const source=redo?pair.before:pair.after,target=redo?pair.after:pair.before;
  const live=liveBlock(editor,source);
  return live?[{source,target,content:live.node.content}]:[];
 })??[];
 // The default paragraph delete filter retains nonempty shells containing peer
 // text. These exact replacement shells have their content transferred below;
 // retaining them too would duplicate that text on redo. Leave all other nodes
 // under the original collaborative deletion policy.
 const sync=ySyncPluginKey.getState(editor.state)!;
 const sources=new Set(edits.map(edit=>Y.createAbsolutePositionFromRelativePosition(edit.source.anchor,sync.doc)?.type));
 const filter=undo?.deleteFilter;
 let done=false;
 try{
  if(undo&&filter)undo.deleteFilter=item=>item.content instanceof Y.ContentType&&sources.has(item.content.type)||filter(item);
  done=redo?editor.commands.redo():editor.commands.undo();
 }finally{if(undo&&filter)undo.deleteFilter=filter;}
 if(done&&pairs){
  (redo?undo?.undoStack:undo?.redoStack)?.at(-1)?.meta.set(STRUCTURE,pairs);
  const targets=edits.flatMap(edit=>{const target=liveBlock(editor,edit.target);return target?[{...edit,target}]:[];});
  const tr=editor.state.tr;
  for(const {target,content} of targets.sort((a,b)=>b.target.pos-a.target.pos)){
   if(!target.node.content.eq(content))tr.replaceWith(target.pos+1,target.pos+1+target.node.content.size,content);
  }
  if(tr.docChanged)editor.view.dispatch(tr.setMeta('addToHistory',false));
 }
 return done;
}
