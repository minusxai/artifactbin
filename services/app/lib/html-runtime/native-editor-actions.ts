/** Structural editor actions preserve complete sibling subtrees and local selections. */
import type { Editor } from '@tiptap/core';
import { Fragment } from 'prosemirror-model';
import { TextSelection } from 'prosemirror-state';
import { yUndoPluginKey } from '@tiptap/y-tiptap';
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
 const selected:import('prosemirror-model').Node[]=[];for(let i=first;i<=last;i++)selected.push(parent.child(i));
 const from=down?start:start-neighbor.nodeSize,to=down?end+neighbor.nodeSize:end;
 const tr=state.tr.replaceWith(from,to,Fragment.fromArray(down?[neighbor,...selected]:[...selected,neighbor]));
 const delta=down?neighbor.nodeSize:-neighbor.nodeSize;
 tr.setSelection(TextSelection.create(tr.doc,selection.anchor+delta,selection.head+delta));editor.view.dispatch(tr.scrollIntoView());return true;
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
   if(next){item.setAttribute('data-type','taskItem');item.setAttribute('data-checked',String(value));item.removeAttribute('role');item.removeAttribute('aria-checked');for(const input of Array.from(item.querySelectorAll('input[type="checkbox"],[role="checkbox"]')))if(input.closest('li')===item)input.remove();}
   run!.append(item);
  }list.remove();
 }return host.innerHTML;
}

const STRUCTURE=Symbol('native-structural-content');
type Block={pos:number;node:import('prosemirror-model').Node};
function blocks(editor:Editor):Block[]{const result:Block[]=[];editor.state.doc.descendants((node,pos)=>{if(node.isTextblock)result.push({node,pos});});return result;}
/** Yjs represents a node-kind change or move as replacement XML. Preserve edits made
 * inside that replacement by peers when undo restores its earlier structural shell. */
export function structural(editor:Editor,action:()=>boolean):boolean {
 const original=editor.state.doc,before=blocks(editor),done=isolated(editor,action),after=blocks(editor);
 if(editor.state.doc.eq(original))return done;
 const pairs=before.flatMap(old=>{const next=after.find(b=>old.node.attrs.afId?b.node.attrs.afId===old.node.attrs.afId:b.node.content.eq(old.node.content));return next?[{before:old,after:next}]:[];});
 const undo=yUndoPluginKey.getState(editor.state)?.undoManager;
 if(done&&undo?.undoStack.length)undo.undoStack.at(-1)!.meta.set(STRUCTURE,pairs);
 return done;
}
export function undoNative(editor:Editor,redo=false):boolean {
 const undo=yUndoPluginKey.getState(editor.state)?.undoManager;
 const item=(redo?undo?.redoStack:undo?.undoStack)?.at(-1);
 const pairs=item?.meta.get(STRUCTURE) as Array<{before:Block;after:Block}>|undefined;
 const current=blocks(editor);
 const edits=pairs?.flatMap(pair=>{
  const source=redo?pair.before:pair.after,target=redo?pair.after:pair.before;
  const live=current.find(b=>source.node.attrs.afId?b.node.attrs.afId===source.node.attrs.afId:b.pos===source.pos);
  return live&&!live.node.content.eq(source.node.content)?[{target,content:live.node.content}]:[];
 })??[];
 const done=redo?editor.commands.redo():editor.commands.undo();
 if(done&&pairs){
  // Carry the structural contract to the inverse stack item too.
  (redo?undo?.undoStack:undo?.redoStack)?.at(-1)?.meta.set(STRUCTURE,pairs);
  const tr=editor.state.tr,restored=blocks(editor);
  for(const edit of edits.sort((a,b)=>b.target.pos-a.target.pos)){
   const target=restored.find(b=>edit.target.node.attrs.afId?b.node.attrs.afId===edit.target.node.attrs.afId:b.pos===edit.target.pos);
   if(target&&!target.node.content.eq(edit.content))tr.replaceWith(target.pos+1,target.pos+1+target.node.content.size,edit.content);
  }
  if(tr.docChanged)editor.view.dispatch(tr.setMeta('addToHistory',false));
 }
 return done;
}
