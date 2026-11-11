/** Native toolbar links must survive the server's identity-only compaction and reload. */
import { afterEach, expect, it } from 'vitest';
import * as Y from 'yjs';
import { TextSelection } from 'prosemirror-state';
import { canonicalizeHtmlPage } from '../../html-page';
import { compactRegion, createRegionState, editableRegions, regionHtml, normalizeRegionHtml, regionMarkdown, validateRegionUpdate } from '../../live-regions';
import { mountRegionEditor } from '../native-region-editor';
const kind='rich-native-v1' as const;
const cleanup:Array<()=>void>=[];
afterEach(()=>cleanup.splice(0).forEach(fn=>fn()));
it.each(['plain','marked'])('persists a %s native link, edits and removes it through compaction and reload',style=>{
 let page=canonicalizeHtmlPage('<!doctype html><html><head><title>Links</title></head><body><article data-af-editable="rich-native-v1"><p data-af-id="af-1">'+(style==='marked'?'<strong data-af-id="af-2"><em data-af-id="af-3">Hello</em></strong>':'Hello')+'</p></article></body></html>');
 const region=editableRegions(page.html)[0]!;
 let server=createRegionState(kind,region.inner).state;
 const root=document.createElement('article');document.body.append(root);
 const editor=mountRegionEditor({win:window,root,regionId:region.id,kind,clientId:501,state:server,post(message){if(message.kind==='region-update')server=Y.encodeStateAsUpdate(validateRegionUpdate(kind,server,message.update,501).doc);}});
 cleanup.push(()=>{editor.destroy();root.remove();});
 const select=()=>editor.view.dispatch(editor.view.state.tr.setSelection(TextSelection.create(editor.view.state.doc,1,6)));
 const save=()=>{
  editor.flush();
  const saved=compactRegion({savedHtml:page.html,ledger:page.ledger,regionId:region.id,state:server});
  editor.remote([saved.update]);
  const doc=new Y.Doc();Y.applyUpdate(doc,server);Y.applyUpdate(doc,saved.update);server=Y.encodeStateAsUpdate(doc);doc.destroy();
  page={...page,html:saved.html,ledger:saved.ledger};
  const inner=editableRegions(saved.html)[0]!.inner;
  expect(regionHtml(kind,server)).toBe(normalizeRegionHtml(kind,inner));
  expect(regionHtml(kind,createRegionState(kind,inner).state)).toBe(normalizeRegionHtml(kind,inner));
  expect(inner).toContain('data-af-id="af-1"');
  if(style==='marked'){expect(inner).toContain('data-af-id="af-2"');expect(inner).toContain('data-af-id="af-3"');}
  return inner;
 };
 select();expect(editor.command('link',{href:'https://example.com/qa'})).toBe(true);
 let inner=save();expect(inner).toContain('href="https://example.com/qa"');
 expect(regionMarkdown(kind,inner)).toContain('https://example.com/qa');
 const anchor=document.createElement('div');anchor.innerHTML=inner;
 const anchorId=anchor.querySelector('a')?.getAttribute('data-af-id');expect(anchorId).toBeTruthy();
 editor.view.dispatch(editor.view.state.tr.setSelection(TextSelection.create(editor.view.state.doc,3)));
 expect(editor.command('link',{href:'https://example.com/edited'})).toBe(true);
 inner=save();expect(inner).toContain('href="https://example.com/edited"');
 anchor.innerHTML=inner;expect(anchor.querySelector('a')?.getAttribute('data-af-id')).toBe(anchorId);
 expect(editor.command('link',{href:null})).toBe(true);
 inner=save();expect(inner).not.toContain('<a');expect(editor.view.state.doc.textContent).toBe('Hello');
});
it.each(['javascript:alert(1)','java\tscript:alert(1)','data:text/html,x','vbscript:x'])('refuses unsafe native link %j without changing the document',href=>{
 const root=document.createElement('article');document.body.append(root);
 const initial=createRegionState(kind,'<p data-af-id="af-1">Hello</p>');
 const editor=mountRegionEditor({win:window,root,regionId:'region',kind,clientId:501,state:initial.state,post(){}});
 cleanup.push(()=>{editor.destroy();root.remove();});
 editor.view.dispatch(editor.view.state.tr.setSelection(TextSelection.create(editor.view.state.doc,1,6)));
 const before=editor.view.state.doc.toJSON();
 expect(editor.command('link',{href})).toBe(false);expect(editor.view.state.doc.toJSON()).toEqual(before);
});
