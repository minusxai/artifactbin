import {expect,it} from 'vitest';
import {createRegionState,regionHtml} from '..';

it('preserves inline comment-anchor identities when legacy HTML becomes native state',()=>{
 const html='<p data-af-id="af-1"><strong data-af-id="af-2">Bold</strong> <em data-af-id="af-3">italic</em> <a data-af-id="af-4" href="https://example.com">link</a><br data-af-id="af-5"><code data-af-id="af-6">code</code></p><pre data-af-id="af-7"><code data-af-id="af-8">const x = 1;\n</code></pre>';
 const native=createRegionState('rich-native-v1',html);
 const projected=regionHtml('rich-native-v1',native.state);
 for(let id=1;id<=8;id++)expect(projected).toContain(`data-af-id="af-${id}"`);
 expect(projected).toContain('const x = 1;\n');
});

it('does not duplicate an inline anchor when nested formatting splits its text',()=>{
 const html='<p data-af-id="af-1"><strong data-af-id="af-2">before <em data-af-id="af-3">nested</em> after</strong></p>';
 const native=createRegionState('rich-native-v1',html);
 const projected=regionHtml('rich-native-v1',native.state);
 expect(projected.match(/data-af-id="af-2"/g)).toHaveLength(1);
 expect(projected).toContain('data-af-id="af-3"');
});

it('refuses empty identified marks during strict migration',async()=>{
 const {convertLegacyPage}=await import('..');
 expect(()=>convertLegacyPage('<article data-af-id="af-1" data-af-editable="rich"><p data-af-id="af-2"><strong data-af-id="af-3"></strong></p></article>')).toThrow();
});
it('keeps repeated sibling block identities distinct',()=>{
 const html='<p data-af-id="af-1">same</p><p data-af-id="af-2">same</p>';
 expect(regionHtml('rich-native-v1',createRegionState('rich-native-v1',html).state)).toBe(html);
});
it('keeps inline and pre/code identities after native save reconciliation',async()=>{
 const {canonicalizeHtmlPage}=await import('../../html-page');
 const {compactRegion,editableRegions,openRegionDoc}=await import('..');
 const Y=await import('yjs');
 const page=canonicalizeHtmlPage('<article data-af-id="af-10" data-af-editable="rich-native-v1"><p data-af-id="af-1"><strong data-af-id="af-2">before <em data-af-id="af-3">nested</em> after</strong></p><pre data-af-id="af-4"><code data-af-id="af-5">a\nb</code></pre></article>');
 const region=editableRegions(page.html)[0]!;
 const state=createRegionState(region.kind,region.inner);
 const saved=compactRegion({savedHtml:page.html,ledger:page.ledger,regionId:region.id,state:state.state});
 const doc=openRegionDoc(state.state,{kind:region.kind});
 Y.applyUpdate(doc,saved.update);
 expect(regionHtml(region.kind,Y.encodeStateAsUpdate(doc))).toBe(editableRegions(saved.html)[0]!.inner);
});
it('writes newly assigned inline and code identities into live state',async()=>{
 const {canonicalizeHtmlPage}=await import('../../html-page');
 const {compactRegion,editableRegions,openRegionDoc}=await import('..');
 const Y=await import('yjs');
 const page=canonicalizeHtmlPage('<article data-af-editable="rich-native-v1"><p><strong>bold</strong></p><pre><code>code</code></pre></article>');
 const region=editableRegions(page.html)[0]!;
 const state=createRegionState(region.kind,region.inner.replace(/ data-af-id="[^"]+"/g,''));
 const saved=compactRegion({savedHtml:page.html,ledger:page.ledger,regionId:region.id,state:state.state});
 const doc=openRegionDoc(state.state,{kind:region.kind});Y.applyUpdate(doc,saved.update);
 expect(regionHtml(region.kind,Y.encodeStateAsUpdate(doc))).toBe(editableRegions(saved.html)[0]!.inner);
});
it('saves when removing bold in the middle splits an identified mark',async()=>{
 const {canonicalizeHtmlPage}=await import('../../html-page');
 const {compactRegion,editableRegions,openRegionDoc}=await import('..');
 const Y=await import('yjs');
 const page=canonicalizeHtmlPage('<article data-af-editable="rich-native-v1"><p><strong>abcdef</strong></p></article>');
 const region=editableRegions(page.html)[0]!;
 const state=createRegionState(region.kind,region.inner),doc=openRegionDoc(state.state,{kind:region.kind});
 const p=doc.getXmlFragment('native-v1').get(0) as import('yjs').XmlElement;
 (p.get(0) as import('yjs').XmlText).format(2,2,{bold:null});
 const saved=compactRegion({savedHtml:page.html,ledger:page.ledger,regionId:region.id,state:Y.encodeStateAsUpdate(doc)});
 Y.applyUpdate(doc,saved.update);
 expect(regionHtml(region.kind,Y.encodeStateAsUpdate(doc))).toBe(editableRegions(saved.html)[0]!.inner);
});
it('renders the nested code anchor in the editor DOM schema',async()=>{
 const {nativeSchema}=await import('../native-schema');
 const node=nativeSchema.nodes.codeBlock!.create({afId:'af-1',codeAfId:'af-2',language:'javascript'},nativeSchema.text('const x=1;'));
 expect(JSON.stringify(node.type.spec.toDOM!(node))).toContain('af-2');
});
