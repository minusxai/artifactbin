/** Native keyboard/clipboard behavior, independent of transport and presentation. */
import { safeHref } from '../live-regions/href';
import type { Editor } from '@tiptap/core';
import { Extension } from '@tiptap/core';
import { Fragment, Slice, type Node as PMNode } from 'prosemirror-model';
import {Plugin, type EditorState, type Transaction} from 'prosemirror-state';

/** Copied blocks are new identities, even when an internal clipboard slice carries original attributes. */
export function freshClipboard(slice:Slice):Slice {
 const clean=(node:PMNode):PMNode=>{
  const marks=node.marks.flatMap(mark=>mark.type.name!=='link'?[mark]:safeHref(mark.attrs.href)===mark.attrs.href?[mark.type.create({href:mark.attrs.href,title:typeof mark.attrs.title==='string'?mark.attrs.title.slice(0,512):null,target:null,rel:'noopener noreferrer nofollow',class:null})]:[]);
  return node.isText?node.mark(marks):node.type.create({...node.attrs,...('afId' in node.attrs?{afId:null}:{})},Fragment.fromArray(Array.from({length:node.childCount},(_,i)=>clean(node.child(i)))),marks);
 };
 return new Slice(Fragment.fromArray(Array.from({length:slice.content.childCount},(_,i)=>clean(slice.content.child(i)))),slice.openStart,slice.openEnd);
}
/** Text indentation is literal two-space text, retained in HTML/Yjs; Shift-Tab without indentation exits normally. */
function indentText(state:EditorState,dispatch:((tr:Transaction)=>void)|undefined,outdent=false):boolean {
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
/** List indentation never falls back to editing text, even when sinking is impossible. */
export function indentNative(editor:Editor,outdent=false):boolean {
 const {state}=editor;
 let item:string|undefined;
 for(let depth=state.selection.$from.depth;depth>0;depth--){
  const name=state.selection.$from.node(depth).type.name;
  if(name==='listItem'||name==='taskItem'){item=name;break;}
 }
 state.doc.nodesBetween(state.selection.from,state.selection.to,node=>{
  if(!item&&(node.type.name==='listItem'||node.type.name==='taskItem'))item=node.type.name;
 });
 if(item){if(outdent)editor.commands.liftListItem(item);else editor.commands.sinkListItem(item);return true;}
 return indentText(state,editor.view.dispatch,outdent);
}
export const NativeIndentation=Extension.create({
 name:'nativeIndentation',priority:1100,
 addKeyboardShortcuts(){return {
  Tab:()=>this.editor.isActive('codeBlock')?false:indentNative(this.editor),
  'Shift-Tab':()=>this.editor.isActive('codeBlock')?false:indentNative(this.editor,true),
  Escape:()=>{this.editor.view.dom.blur();return true;},
 };},
});

/** Follow the original content through splits; a copied identity must not move an existing comment to new text. */
export const NativeIdentityRepair=Extension.create({
 name:'nativeIdentityRepair',
 addProseMirrorPlugins(){
  // Keep the first original content point across typing transactions. Re-seeding it
  // from the block start would mistake prepended text for the original at a later split.
  const points=(doc:PMNode,previous=new Map<string,number>(),tr?:Transaction)=>{
   const next=new Map<string,number>();
   doc.descendants((node,pos)=>{if(!node.isText)for(const key of ['afId','codeAfId']){
    const id=node.attrs[key];if(typeof id!=='string'||!id||next.has(id))continue;
    // Item anchors start inside their first paragraph so a start split follows
    // the original text. Keep that point across transactions, just like paragraphs.
    const start=pos+1+((node.type.name==='listItem'||node.type.name==='taskItem')&&node.firstChild?.isTextblock?1:0);
    const point=previous.get(id);next.set(id,point===undefined?start:tr?tr.mapping.map(point,1):point);
   }});return next;
  };
  const plugin:Plugin<Map<string,number>>=new Plugin({
   state:{init:(_,state)=>points(state.doc),apply:(tr,previous)=>points(tr.doc,previous,tr)},
   appendTransaction(transactions,_old,state){
  if(!transactions.some(tr=>tr.docChanged))return null;
  const original=plugin.getState(state)!;
  const retained=new Map<string,number>();let repair:Transaction|undefined;
  state.doc.descendants((node,pos)=>{if(!node.isText)for(const key of ['afId','codeAfId']){
   const id=node.attrs[key];if(typeof id!=='string'||!id)continue;
   const point=original.get(id);
   if(!retained.has(id)||(point!==undefined&&pos<point&&point<pos+node.nodeSize))retained.set(id,pos);
  }});
  state.doc.descendants((node,pos)=>{
   if(node.isText)return;
   let attrs=node.attrs;
   for(const key of ['afId','codeAfId']){const id=attrs[key];if(typeof id!=='string'||!id)continue;if(retained.get(id)!==pos)attrs={...attrs,[key]:null};}
   if(attrs!==node.attrs){repair??=state.tr;repair.setNodeMarkup(pos,undefined,attrs);}
  });
  return repair?.setMeta('addToHistory',false)??null;
 }});return [plugin];},
});
