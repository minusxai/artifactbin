/**
 * THE PREVIEW'S STORY CONTROLLER — framework-free, adapted from components/IslandStory.tsx's
 * `createIslandController` for a local file instead of a hosted artifact: the same compiled DOM,
 * the same edit session (lib/story-runtime/edit/session createFrameEditSession), DOM-mounter
 * (solid/editor/dom-mounter), selection-actions and annotate sessions (lib/story-runtime/edit/*) —
 * only a structural edit's recompile goes through this process's own `/draft` door (compiled.ts)
 * instead of `/a/:id/draft-preview`.
 *
 * This is the `StoryController` PR #219's solid-routes.ts calls out as missing for the compiled DOM
 * (Document.tsx adopts the story but never establishes one, so every capability gated on it —
 * in-place editing, the selection bubble, AnnotationLayer's anchor picking — sits inert). Built here
 * first because local preview needed it; the hosted Solid page can mount the same shape.
 */
import type {JsxNode} from '../../../app/lib/jsx';
import {serializeJsx} from '../../../app/lib/jsx';
import type {StoryController} from '../../../app/lib/story-runtime/contract';
import {STORY_ANNOTATIONS_MESSAGE,STORY_EDIT_MODE_MESSAGE,STORY_SELECTION_ACTIONS_MESSAGE,STORY_SELECTION_ACTION_MESSAGE,STORY_SELECT_MESSAGE,isEditParentMessage,type StoryDocumentUpdate} from '../../../app/lib/story-runtime/contract';
import {isStoryDocumentUpdate} from '../../../app/lib/story-runtime/document-update';
import {runtimeId} from '../../../app/lib/story-runtime/runtime-id';
import type {RuntimeChannel} from '../../../app/lib/story-runtime/pristine';
import type {FrameEditSession} from '../../../app/lib/story-runtime/edit/session';
import type {FrameSelectionActions} from '../../../app/lib/story-runtime/edit/selection-actions';
import type {FrameAnnotateSession} from '../../../app/lib/story-runtime/edit/annotate';

export interface PreviewEditControllerInput {
 win:Window;root:HTMLElement;file:string;
 initialNodes:JsxNode[];
 /** The current full source, so a structural draft asks the server with what the page is showing NOW. */
 sourceRef:{current:string};
 /** Raw-source editing requests structural drafts without mounting a WYSIWYG session. */
 isSourceEditing?():boolean;
 /** Where the selection bubble ("comment"/"edit") mounts. Absent: no selection-driven picking. */
 portal?:HTMLElement;
 onStatus?(status:string):void;
}

/** `StoryController` plus IslandStory's own extension: the portal arrived after the controller did. */
export interface PreviewStoryController extends StoryController {selectionReady():void}

const componentIds=(source:JsxNode[]):Map<string,string>=>{
 const found=new Map<string,string>();
 const visit=(items:JsxNode[])=>{for(const item of items){
  if(item.type!=='element')continue;
  const id=item.attributes.find(attribute=>attribute.name==='id')?.value;
  if(item.isComponent&&id?.static&&typeof id.json==='string')found.set(id.json,serializeJsx([item]));
  visit(item.children);
 }};
 visit(source);return found;
};
const componentPaths=(source:JsxNode[]):Map<string,string>=>{
 const found=new Map<string,string>();
 const visit=(items:JsxNode[],parent=''):void=>{items.forEach((item,index)=>{
  if(item.type!=='element')return;
  const path=[parent,index].filter(part=>part!=='').join('.');
  if(item.isComponent)found.set(path,serializeJsx([item]));
  visit(item.children,path);
 });};
 visit(source);return found;
};

/** One preview document's private handle for `createInPlaceEdit`'s `DocumentRuntimeRef`. */
export function createPreviewEditController({win,root,file,initialNodes,sourceRef,portal,onStatus,isSourceEditing=()=>false}:PreviewEditControllerInput):PreviewStoryController {
 let nodes:JsxNode[]=initialNodes;
 let disposed=false;
 const listeners=new Set<(event:unknown)=>void>();
 const nonce=runtimeId();
 const emit=(event:unknown)=>{if(!disposed)for(const listener of [...listeners])listener(event);};
 const channel:RuntimeChannel={nonce,post:event=>queueMicrotask(()=>emit(event)),innerHtmlOf:element=>element.innerHTML};
 let edit:FrameEditSession|null=null;
 let editRequested=false;
 const canPreviewDraft=()=>editRequested||isSourceEditing();
 let editLoading=false;
 let selection:FrameSelectionActions|null=null;
 let selectionFactory:typeof import('../../../app/lib/story-runtime/edit/selection-actions').createFrameSelectionActions|null=null;
 let selectionCommand:Parameters<FrameSelectionActions['update']>[0]|null=null;
 let selectionLoading=false;
 // The selection bubble ("comment"/"edit"), over the SAME picked text AnnotationLayer anchors a new thread to.
 const ensureSelection=():void=>{
  if(disposed||selection||!selectionFactory||!portal||!selectionCommand||(!selectionCommand.edit&&!selectionCommand.annotate))return;
  selection=selectionFactory({win,root,portal,onAction:(action,selected)=>emit({type:STORY_SELECTION_ACTION_MESSAGE,nonce,action,selection:selected})});
  selection.setNodes(nodes);
  selection.update(selectionCommand);
 };
 // The pin/highlight overlay for EXISTING comment threads (AnnotationLayer sends what to draw; this
 // never originates a thread itself).
 let annotate:FrameAnnotateSession|null=null;
 let annotationCommand:Parameters<FrameAnnotateSession['update']>[0]|null=null;
 let annotationLoading=false;
 let draftSequence=0;
 let lastDraftSource:string|null=null;
 let quietDraftTimer:number|null=null;
 let pendingDraft:{document:Document;root:HTMLElement;sheets:HTMLStyleElement[];nodes:JsxNode[];source:string;stableIds:Set<string>;stablePaths:Set<string>;sequence:number}|null=null;
 /** A document sheet's identifying attribute: every `<style data-mx-*>` the standalone document carries (lib/story/styles/document-styles). */
 const sheetAttr=(style:HTMLStyleElement)=>style.getAttributeNames().find(name=>name.startsWith('data-mx-'))??null;
 const documentSheets=(doc:Document)=>Array.from(doc.head.querySelectorAll<HTMLStyleElement>('style')).filter(style=>sheetAttr(style)!==null);
 /**
  * The live page takes the draft's sheets by attribute, in the draft's order: a changed one swaps its text
  * (compiled utilities, author CSS), an unchanged one (the fonts, the design system) is left alone, one the
  * draft adds (its first Helmet style) is inserted where the document carries it, one it drops is emptied.
  */
 const swapSheets=(live:Document,drafts:HTMLStyleElement[])=>{
  const current=new Map(documentSheets(live).map(style=>[sheetAttr(style)!,style] as const));
  let anchor:HTMLStyleElement|null=null;
  for(const draft of drafts){
   const attr=sheetAttr(draft)!,text=draft.textContent??'';
   let style=current.get(attr)??null;current.delete(attr);
   if(!style){style=live.importNode(draft,true);if(anchor)anchor.after(style);else live.head.appendChild(style);}
   else if(style.textContent!==text)style.textContent=text;
   anchor=style;
  }
  for(const style of current.values())style.textContent='';
 };
 const stableIdsFor=(next:JsxNode[],previous:JsxNode[]):Set<string>=>{
  const before=componentIds(previous),after=componentIds(next);
  return new Set([...after].filter(([id,value])=>before.get(id)===value).map(([id])=>id));
 };
 const stablePathsFor=(next:JsxNode[],previous:JsxNode[]):Set<string>=>{
  const before=componentPaths(previous),after=componentPaths(next);
  return new Set([...after].filter(([path,text])=>before.get(path)===text).map(([path])=>path));
 };
 const focusedRegion=():boolean=>{
  const active=win.document.activeElement;
  return active instanceof HTMLElement&&root.contains(active)&&!!active.closest('[data-mx-edit-region]');
 };
 const applyDraft=async(allowFocused=false):Promise<void>=>{
  const pending=pendingDraft;
  if(!pending||(focusedRegion()&&(!allowFocused||!edit?.canApplyDraft()))||disposed||!canPreviewDraft()||pending.sequence!==draftSequence)return;
  const {disposeChangedDraftIslands,hydrateDraftIslands,morphDraftDom}=await import('../../../app/lib/islands/morph/engine');
  if(disposed||!canPreviewDraft()||pending.sequence!==draftSequence||pendingDraft!==pending)return;
  pendingDraft=null;
  if(quietDraftTimer!==null){win.clearTimeout(quietDraftTimer);quietDraftTimer=null;}
  swapSheets(win.document,pending.sheets);
  edit?.unmountCompiledDom();
  disposeChangedDraftIslands(root,pending.stableIds,pending.stablePaths);
  morphDraftDom(root,pending.root,pending.stableIds,pending.stablePaths);
  await hydrateDraftIslands(win,root,pending.document,pending.stableIds,pending.stablePaths);
  nodes=pending.nodes;lastDraftSource=pending.source;
  edit?.setNodes(nodes);
  await edit?.mountCompiledDom();
  annotate?.setNodes(nodes);
  selection?.setNodes(nodes);
 };
 const onFocusOut=()=>{queueMicrotask(()=>{void applyDraft();});};
 win.document.addEventListener('focusout',onFocusOut,true);
 const controller:PreviewStoryController={
  nonce,
  selectionReady:ensureSelection,
  send(command:unknown){
   if(disposed||!command||typeof command!=='object')return;
   if(isStoryDocumentUpdate(command)){controller.update(command);return;}
   if(!isEditParentMessage(command))return;
   if(command.type===STORY_EDIT_MODE_MESSAGE){
    editRequested=command.on;
    if(!command.on){draftSequence++;pendingDraft=null;if(quietDraftTimer!==null)win.clearTimeout(quietDraftTimer);quietDraftTimer=null;edit?.dispose();edit=null;return;}
    if(edit||editLoading)return;
    editLoading=true;
    void Promise.all([import('../../../app/lib/story-runtime/edit/session'),import('../../../app/solid/editor/dom-mounter')]).then(([{createFrameEditSession},{mountCompiledEditRegions}])=>{
     if(disposed||!editRequested)return;
     edit=createFrameEditSession({win,root,channel,requestRender:()=>{},mountCompiled:mountCompiledEditRegions});
     edit.setNodes(nodes);
     return edit.mountCompiledDom();
    }).catch(error=>{if(!disposed)onStatus?.(error instanceof Error?error.message:String(error));}).finally(()=>{editLoading=false;});
    return;
   }
   if(edit){
    edit.onParentMessage(command);
    if(command.type!==STORY_ANNOTATIONS_MESSAGE&&command.type!==STORY_SELECTION_ACTIONS_MESSAGE&&command.type!==STORY_SELECT_MESSAGE)return;
   }
   if(command.type===STORY_ANNOTATIONS_MESSAGE){
    annotationCommand=command;
    if(annotate){annotate.update(command);return;}
    if(command.mode==='off'||annotationLoading)return;
    annotationLoading=true;
    void import('../../../app/lib/story-runtime/edit/annotate').then(({createFrameAnnotateSession})=>{
     if(disposed)return;
     annotate=createFrameAnnotateSession({win,root,channel,isEditing:()=>editRequested});
     annotate.setNodes(nodes);
     if(annotationCommand)annotate.update(annotationCommand);
    }).catch(error=>{if(!disposed)onStatus?.(error instanceof Error?error.message:String(error));}).finally(()=>{annotationLoading=false;});
    return;
   }
   if(command.type===STORY_SELECTION_ACTIONS_MESSAGE){
    selectionCommand=command;
    if(selection){selection.update(command);return;}
    if(selectionFactory){ensureSelection();return;}
    if((!command.edit&&!command.annotate)||selectionLoading)return;
    selectionLoading=true;
    void import('../../../app/lib/story-runtime/edit/selection-actions').then(({createFrameSelectionActions})=>{
     selectionFactory=createFrameSelectionActions;
     ensureSelection();
    }).catch(error=>{if(!disposed)onStatus?.(error instanceof Error?error.message:String(error));}).finally(()=>{selectionLoading=false;});
    return;
   }
   if(command.type===STORY_SELECT_MESSAGE)annotate?.select(command.path);
  },
  update(command:StoryDocumentUpdate){
   if(disposed)return;
   if(canPreviewDraft()&&command.source!==undefined){
    const sequence=++draftSequence;
    const source=command.source;
    void win.fetch('/draft',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({file,source})}).then(async response=>{
     if(response.status===400||response.status===422)return;
     if(!response.ok)throw new Error(`draft preview answered ${response.status}`);
     const payload=await response.json() as {html:string};
     const next=new DOMParser().parseFromString(payload.html,'text/html');
     if(disposed||sequence!==draftSequence||!canPreviewDraft())return;
     const nextRoot=next.querySelector<HTMLElement>('[data-mx-inline-story]');
     if(!nextRoot)throw new Error('draft preview carried no story');
     const baseline=lastDraftSource??sourceRef.current;
     const {storyUpdateParts}=await import('../../../app/lib/story/document/update-parts');
     const before=baseline?storyUpdateParts(baseline)?.nodes??nodes:nodes;
     const after=storyUpdateParts(source)?.nodes??command.nodes;
     pendingDraft={document:next,root:nextRoot,sheets:documentSheets(next),nodes:command.nodes,source,
      stableIds:stableIdsFor(after,before),stablePaths:stablePathsFor(after,before),sequence};
     await applyDraft();
     if(pendingDraft?.sequence===sequence&&quietDraftTimer===null)quietDraftTimer=win.setTimeout(()=>{quietDraftTimer=null;void applyDraft(true);},500);
    }).catch(error=>{if(!disposed)onStatus?.(error instanceof Error?error.message:String(error));});
    return;
   }
   if(command.nodes){nodes=command.nodes;annotate?.setNodes(nodes);selection?.setNodes(nodes);}
  },
  invalidate(){/* the preview's own islands re-run their own queries on write; nothing to force here. */},
  subscribe(listener){if(!disposed)listeners.add(listener);return()=>{listeners.delete(listener);};},
  getViewportRect:()=>new DOMRect(0,0,win.innerWidth,win.innerHeight),
  dispose(){
   if(disposed)return;disposed=true;listeners.clear();
   edit?.dispose();edit=null;
   annotate?.dispose();annotate=null;
   selection?.dispose();selection=null;
   if(quietDraftTimer!==null)win.clearTimeout(quietDraftTimer);
   win.document.removeEventListener('focusout',onFocusOut,true);
  },
 };
 return controller;
}
