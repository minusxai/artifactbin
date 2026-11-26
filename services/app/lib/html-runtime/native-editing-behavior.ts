/** Native keyboard/clipboard behavior, independent of transport and presentation; list indentation and the clipboard
 * rule are lib/markdown/editing.ts's, shared with the Markdown field. */
import { isolated } from './native-editor-actions';
import { safeHref } from '../live-regions/href';
import { Extension } from '@tiptap/core';
import type { Node as PMNode, Slice } from 'prosemirror-model';
import { Plugin, type Transaction } from 'prosemirror-state';
import { freshClipboard as sharedFreshClipboard, indentNative } from '../markdown/editing';

export { indentNative };

/** Copied blocks are new identities, even when an internal clipboard slice carries original attributes; a region keeps only the
 * links safeHref leaves unchanged. */
export const freshClipboard = (slice: Slice): Slice => sharedFreshClipboard(slice, href => safeHref(href) === href);
export const NativeIndentation=Extension.create({
 name:'nativeIndentation',priority:1100,
 addKeyboardShortcuts(){return {
  Tab:()=>this.editor.isActive('codeBlock')?false:isolated(this.editor,()=>indentNative(this.editor)),
  'Shift-Tab':()=>this.editor.isActive('codeBlock')?false:isolated(this.editor,()=>indentNative(this.editor,true)),
  Escape:()=>{this.editor.view.dom.blur();return true;},
 };},
});

export const NativeEditorShortcuts = Extension.create({
  name: 'nativeEditorShortcuts',
  priority: 1100,
  addKeyboardShortcuts() {
    return {
      'Ctrl-e': () => this.editor.commands.selectTextblockEnd(),
      'Mod-Shift-e': () => isolated(this.editor, () => this.editor.commands.toggleCode()),
    };
  },
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
  // Identity repair belongs to the triggering edit's undo group. Excluding the
  // appended transaction also excludes the Yjs synchronization of the split.
  return repair??null;
 }});return [plugin];},
});
