import { expect, it } from 'vitest';
import * as Y from 'yjs';
import { canonicalizeHtmlPage } from '../../html-page';
import { applyRegionRevision, compactRegion, editableRegions, regionMarkdown, createRegionState, regionHtml, validateRegionUpdate, openRegionDoc, type RegionKind } from '..';
const kind = 'rich-native-v1' as RegionKind;
const html = '<p data-af-id="af-1">Keep anchor</p><ul data-af-id="af-2"><li data-af-id="af-3"><p data-af-id="af-4">Parent</p><ul data-af-id="af-5"><li data-af-id="af-6"><p data-af-id="af-7">Child</p></li></ul></li></ul>';
it('roundtrips explicitly versioned native XML and preserves nested block identities', () => {
  const initial = createRegionState(kind, html);
  const doc = openRegionDoc(initial.state, { kind } as Parameters<typeof openRegionDoc>[1]);
  expect(doc.getXmlFragment('native-v1').length).toBe(2);
  expect(regionHtml(kind, initial.state)).toBe(html);
});
it('accepts an attributed native text edit but refuses it in the legacy format', () => {
  const initial = createRegionState(kind, html);
  const client = openRegionDoc(initial.state, { kind, clientId: 987 } as Parameters<typeof openRegionDoc>[1]);
  const before = Y.encodeStateVector(client);
  const paragraph = client.getXmlFragment('native-v1').get(0) as Y.XmlElement;
  (paragraph.get(0) as Y.XmlText).insert(0, 'New ');
  const update = Y.encodeStateAsUpdate(client, before);
  expect(() => validateRegionUpdate(kind, initial.state, update, 987)).not.toThrow();
  expect(() => validateRegionUpdate('rich', initial.state, update, 987)).toThrow();
  expect(() => validateRegionUpdate(kind, initial.state, update, 988)).toThrow();
});
it('preserves peer first insertion when local native edits are undone and reconnected', () => {
  const initial = createRegionState(kind, '<p data-af-id="af-1"></p>');
  const a = openRegionDoc(initial.state, { kind, clientId: 987 } as Parameters<typeof openRegionDoc>[1]);
  const b = openRegionDoc(initial.state, { kind, clientId: 988 } as Parameters<typeof openRegionDoc>[1]);
  const root = a.getXmlFragment('native-v1');
  const undo = new Y.UndoManager(root, { trackedOrigins: new Set(['local']) });
  const aText = new Y.XmlText();
  a.transact(() => { (root.get(0) as Y.XmlElement).insert(0, [aText]); aText.insert(0, 'Alice'); }, 'local');
  const bText = new Y.XmlText();
  b.transact(() => { (b.getXmlFragment('native-v1').get(0) as Y.XmlElement).insert(0, [bText]); bText.insert(0, 'Bob'); }, 'local');
  Y.applyUpdate(a, Y.encodeStateAsUpdate(b), 'remote');
  undo.undo();
  Y.applyUpdate(b, Y.encodeStateAsUpdate(a), 'remote');
  expect(regionHtml(kind, Y.encodeStateAsUpdate(a))).toContain('Bob');
  expect(regionHtml(kind, Y.encodeStateAsUpdate(a))).not.toContain('Alice');
  expect(regionHtml(kind, Y.encodeStateAsUpdate(b))).toBe(regionHtml(kind, Y.encodeStateAsUpdate(a)));
});

it('rejects executable native links, attributes, and unsupported nodes', () => {
 for (const bad of ['<p onclick="alert(1)">bad</p>', '<p><a href="javascript:alert(1)">bad</a></p>', '<script>bad</script>']) {
  expect(() => createRegionState(kind,bad)).toThrow();
 }
 const initial=createRegionState(kind,'<p data-af-id="af-1">safe</p>');
 const client=openRegionDoc(initial.state,{kind,clientId:987});
 const before=Y.encodeStateVector(client);
 (client.getXmlFragment('native-v1').get(0) as Y.XmlElement).setAttribute('onclick','alert(1)');
 expect(()=>validateRegionUpdate(kind,initial.state,Y.encodeStateAsUpdate(client,before),987)).toThrow();
});

it('merges a saved-snapshot HTML revision without deleting unsaved peer text', () => {
 const initial=createRegionState(kind,'<p data-af-id="af-1">First</p><p data-af-id="af-2">Second</p>');
 const client=openRegionDoc(initial.state,{kind,clientId:987});
 const text=(client.getXmlFragment('native-v1').get(1) as Y.XmlElement).get(0) as Y.XmlText;
 text.insert(text.length,' peer');
 const revision=applyRegionRevision({kind,live:Y.encodeStateAsUpdate(client),savedSnapshot:initial.snapshot,html:'<p data-af-id="af-1">Changed</p><p data-af-id="af-2">Second</p>'});
 Y.applyUpdate(client,revision.update);
 expect(regionHtml(kind,Y.encodeStateAsUpdate(client))).toBe('<p data-af-id="af-1">Changed</p><p data-af-id="af-2">Second peer</p>');
});

it('compaction writes nested identities back without changing existing anchors',()=>{
 const page=canonicalizeHtmlPage('<!doctype html><html><head><title>Native</title></head><body><article data-af-editable="rich-native-v1">'+html+'</article></body></html>');
 const region=editableRegions(page.html)[0]!;
 const initial=createRegionState(kind,region.inner);
 const doc=openRegionDoc(initial.state,{kind,clientId:987});
 const p=new Y.XmlElement('paragraph');const text=new Y.XmlText();text.insert(0,'Added');p.insert(0,[text]);doc.getXmlFragment('native-v1').insert(2,[p]);
 const saved=compactRegion({savedHtml:page.html,ledger:page.ledger,regionId:region.id,state:Y.encodeStateAsUpdate(doc)});
 Y.applyUpdate(doc,saved.update);
 const content=editableRegions(saved.html)[0]!.inner;
 expect(content).toContain('<p data-af-id="af-1">Keep anchor</p>');
 expect(content).toMatch(/<ul[^>]*><li[^>]*><p[^>]*>Parent<\/p><ul/);
 expect(regionHtml(kind,Y.encodeStateAsUpdate(doc))).toBe(content);
 expect(regionHtml(kind,Y.encodeStateAsUpdate(openRegionDoc(Y.encodeStateAsUpdate(doc),{kind})))).toBe(content);
});
it('native task Markdown keeps checks and nesting through an agent roundtrip',()=>{
 const source='<ul data-type="taskList"><li data-type="taskItem" data-checked="true"><p>Done</p><ul data-type="taskList"><li data-type="taskItem" data-checked="false"><p>Next</p></li></ul></li></ul>';
 const initial=createRegionState(kind,source);
 const markdown=regionMarkdown(kind,source);
 expect(markdown).toContain('[x] Done');expect(markdown).toContain('[ ] Next');
 const revision=applyRegionRevision({kind,live:initial.state,savedSnapshot:initial.snapshot,markdown});
 const doc=openRegionDoc(initial.state,{kind});Y.applyUpdate(doc,revision.update);
 expect(regionHtml(kind,Y.encodeStateAsUpdate(doc))).toBe(source);
});
it('malformed nested XML is refused rather than repaired during validation',()=>{
 const initial=createRegionState(kind,'<p data-af-id="af-1">safe</p>');
 const client=openRegionDoc(initial.state,{kind,clientId:987});const before=Y.encodeStateVector(client);
 (client.getXmlFragment('native-v1').get(0) as Y.XmlElement).insert(1,[new Y.XmlElement('paragraph')]);
 expect(()=>validateRegionUpdate(kind,initial.state,Y.encodeStateAsUpdate(client,before),987)).toThrow();
});
it('keeps fenced code language metadata through HTML and Markdown roundtrips',()=>{
 const source='<pre data-af-id="af-1"><code class="language-ts">const x = 1;</code></pre>';
 const initial=createRegionState(kind,source);
 expect(regionHtml(kind,initial.state)).toBe(source);
 expect(regionMarkdown(kind,source)).toContain('```ts');
});
it('agent Markdown insertion retains identities of unchanged following blocks',()=>{
 const initial=createRegionState(kind,'<p data-af-id="af-1">First</p><p data-af-id="af-2">Second</p>');
 const revision=applyRegionRevision({kind,live:initial.state,savedSnapshot:initial.snapshot,markdown:'Inserted\n\nFirst\n\nSecond'});
 const doc=openRegionDoc(initial.state,{kind});Y.applyUpdate(doc,revision.update);
 expect(regionHtml(kind,Y.encodeStateAsUpdate(doc))).toContain('<p data-af-id="af-1">First</p><p data-af-id="af-2">Second</p>');
});
it('rejects hidden map attributes on native XML text',()=>{
 const initial=createRegionState(kind,'<p>safe</p>');
 const client=openRegionDoc(initial.state,{kind,clientId:987});const before=Y.encodeStateVector(client);
 const text=(client.getXmlFragment('native-v1').get(0) as Y.XmlElement).get(0) as Y.XmlText;
 text.setAttribute('onclick','unsafe');
 expect(()=>validateRegionUpdate(kind,initial.state,Y.encodeStateAsUpdate(client,before),987)).toThrow();
});
it('literal paragraph indentation survives the native Markdown agent roundtrip',()=>{
 const html='<p data-af-id="af-1">    Indented text</p>';
 const initial=createRegionState(kind,html);
 const markdown=regionMarkdown(kind,html);
 const revised=applyRegionRevision({kind,live:initial.state,savedSnapshot:initial.snapshot,markdown});
 const doc=openRegionDoc(initial.state,{kind});Y.applyUpdate(doc,revised.update);
 expect(regionHtml(kind,Y.encodeStateAsUpdate(doc))).toBe(html);
});

it('retains adjacent ordinary and checked task lists through agent Markdown',()=>{
 const source='<ul><li><p>Ordinary</p></li></ul><ul data-type="taskList"><li data-type="taskItem" data-checked="true"><p>Done</p></li></ul>';
 const initial=createRegionState(kind,source);
 const revised=applyRegionRevision({kind,live:initial.state,savedSnapshot:initial.snapshot,markdown:regionMarkdown(kind,source)});
 const doc=openRegionDoc(initial.state,{kind});Y.applyUpdate(doc,revised.update);
 expect(regionHtml(kind,Y.encodeStateAsUpdate(doc))).toBe(source);
});
