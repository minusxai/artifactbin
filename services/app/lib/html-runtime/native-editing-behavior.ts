/** Native keyboard/clipboard behavior, independent of transport and presentation. */
import { safeHref } from '../live-regions/href';
import { Extension } from '@tiptap/core';
import { Fragment, Slice, type Node as PMNode } from 'prosemirror-model';
import type { EditorState, Transaction } from 'prosemirror-state';

/** Copied blocks are new identities, even when an internal clipboard slice carries original attributes. */
export function freshClipboard(slice:Slice):Slice {
 const clean=(node:PMNode):PMNode=>{
  const marks=node.marks.flatMap(mark=>mark.type.name!=='link'?[mark]:safeHref(mark.attrs.href)===mark.attrs.href?[mark.type.create({href:mark.attrs.href,title:typeof mark.attrs.title==='string'?mark.attrs.title.slice(0,512):null,target:null,rel:'noopener noreferrer nofollow',class:null})]:[]);
  return node.isText?node.mark(marks):node.type.create({...node.attrs,...('afId' in node.attrs?{afId:null}:{})},Fragment.fromArray(Array.from({length:node.childCount},(_,i)=>clean(node.child(i)))),marks);
 };
 return new Slice(Fragment.fromArray(Array.from({length:slice.content.childCount},(_,i)=>clean(slice.content.child(i)))),slice.openStart,slice.openEnd);
}
/** Text indentation is literal two-space text, retained in HTML/Yjs; Shift-Tab without indentation exits normally. */
export function indentText(state:EditorState,dispatch:((tr:Transaction)=>void)|undefined,outdent=false):boolean {
 const changes:Array<{pos:number;remove:number}>=[];
 state.doc.nodesBetween(state.selection.from,state.selection.to,(node,pos)=>{
  if(!node.isTextblock)return true;
  const remove=outdent?Math.min(2,/^ */.exec(node.textContent)![0].length):0;
  if(!outdent||remove)changes.push({pos:pos+1,remove});return false;
 });
 if(!changes.length)return false;
 if(dispatch){const tr=state.tr;for(const change of changes.reverse()){if(outdent)tr.delete(change.pos,change.pos+change.remove);else tr.insertText('  ',change.pos);}dispatch(tr.scrollIntoView());}
 return true;
}
export const NativeIndentation=Extension.create({
 name:'nativeIndentation',priority:1100,
 addKeyboardShortcuts(){return {
  Tab:()=>this.editor.isActive('codeBlock')?false:this.editor.commands.sinkListItem(this.editor.isActive('taskItem')?'taskItem':'listItem')||indentText(this.editor.state,this.editor.view.dispatch),
  'Shift-Tab':()=>this.editor.isActive('codeBlock')?false:indentText(this.editor.state,this.editor.view.dispatch,true)||this.editor.commands.liftListItem(this.editor.isActive('taskItem')?'taskItem':'listItem'),
  Escape:()=>{this.editor.view.dom.blur();return true;},
 };},
});
