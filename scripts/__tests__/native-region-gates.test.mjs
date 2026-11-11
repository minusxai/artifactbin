/** Main's live editing shards must exercise the native mount and identity contract in pr fast. */
import {expect,it} from 'vitest';
import {readFileSync} from 'node:fs';
import {nativeRegionFacts,NATIVE_TASK_CHECKBOX} from '../gates/lib/native-region-facts.mjs';
const read=file=>readFileSync(new URL(`../../${file}`,import.meta.url),'utf8');
it.each(['live-regions','live-regions-oop'])('%s targets the native editable child rather than its inert region wrapper',name=>{
 const source=read(`scripts/gates/gate-${name}.mjs`);
 expect(source).toContain('data-af-editable="rich-native-v1"');
 expect(source).toContain('const EDITOR = `${REGION} > [contenteditable="true"]`');
 expect(source).not.toMatch(/locator\(REGION\)\.getAttribute\('contenteditable'\)/);
});
it('native formatting publishes stored marks on transactions, including mark-only commands',()=>{
 const source=read('services/app/lib/html-runtime/native-region-editor.ts');
 expect(source).toContain('editor.state.storedMarks ?? s.$head.marks()');
 expect(source).toContain('onTransaction:()=>caret()');
});

it('agent content checks preserve text and marks with allocated inline identities',()=>{
 const facts=nativeRegionFacts('<article data-af-id="notes"><p data-af-id="af-1">typing-before-agent typing-after-read</p><p>Agent line from <strong data-af-id="af-2">Markdown</strong>.</p></article>');
 expect(facts.text).toContain('typing-before-agent typing-after-read');
 expect(facts.strong).toEqual(['Markdown']);
 expect(nativeRegionFacts('<article data-af-id="notes"><p>Agent line from Markdown.</p></article>').strong).toEqual([]);
 expect(facts.text.split('typing-before-agent')).toHaveLength(2);
});
it('gate task lookup uses the native node view rather than saved-only data-type',()=>{
 expect(NATIVE_TASK_CHECKBOX).toBe('li[data-checked] input[type="checkbox"]');
 expect(read('scripts/gates/gate-live-regions.mjs')).toContain('${EDITOR} ${NATIVE_TASK_CHECKBOX}');
});

it('reads the region API inner HTML response without requiring a page wrapper',()=>{
 expect(nativeRegionFacts('<p>Agent line from <strong data-af-id="af-2">Markdown</strong>.</p>')).toEqual({text:'Agent line from Markdown.',strong:['Markdown']});
});
