/** Prism tokens are view decorations only, never document nodes or CRDT content. */
import { Extension } from '@tiptap/core';
import { Plugin } from 'prosemirror-state';
import { Decoration, DecorationSet } from 'prosemirror-view';
import { renderCodeBlock } from '../markdown/code-block';
export const NativeCodePresentation=Extension.create({
 name:'nativeCodePresentation',
 addProseMirrorPlugins(){return [new Plugin({props:{decorations(state){
  const decorations:Decoration[]=[];
  state.doc.descendants((node,pos)=>{
   if(node.type.name!=='codeBlock')return;
   const template=document.createElement('template');template.innerHTML=renderCodeBlock(node.textContent,node.attrs.language);
   let at=pos+1;
   const walk=(element:Node)=>{if(element.nodeType===3){at+=element.textContent?.length??0;return;}const start=at;element.childNodes.forEach(walk);if(element instanceof HTMLElement&&element.className.startsWith('mx-code-token-')&&at>start)decorations.push(Decoration.inline(start,at,{class:element.className}));};
   template.content.childNodes.forEach(walk);
  });return DecorationSet.create(state.doc,decorations);
 }}})];},
});
