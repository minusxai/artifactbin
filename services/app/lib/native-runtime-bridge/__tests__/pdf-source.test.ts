import {expect,it} from 'vitest';
import {rewriteNativeRuntimePdfLinks} from '../pdf-source';
it('rejects authored query keys that could replace the mapped asset identity',()=>{
 const imported={path:'assets/source.pdf',id:'SourceAsset',revision:'1',objectKey:'object',sha256:'a'.repeat(64),bytes:100,sourceAssets:[]};
 expect(()=>rewriteNativeRuntimePdfLinks('<a href="./assets/source.pdf?dependency=other#page=1">PDF</a>','RuntimePdf',[imported])).toThrow('native_runtime_pdf_link_query_conflict');
});
it('maps only exact local links to verified PDFs, keeping authored query, fragment and every other link',()=>{
 const imported={path:'assets/source.pdf',id:'SourceAsset',revision:'2',objectKey:'object',sha256:'a'.repeat(64),bytes:100,sourceAssets:[]};
 const html='<a href="./assets/source.pdf?download=1#page=2">A</a><a href=\'assets/%73ource.pdf\'>B</a><a href="/assets/source.pdf">C</a><a href="https://x.test/assets/source.pdf">D</a><a href="./assets/other.pdf">E</a><a href="%E0%A4%A">F</a><template><a href="./assets/source.pdf">G</a></template>';
 const out=rewriteNativeRuntimePdfLinks(html,'Page',[imported]);
 expect(out).toContain('href="/a/Page/assets?dependency=SourceAsset&amp;revision=2&amp;download=1#page=2">A');
 expect(out).toContain('href="/a/Page/assets?dependency=SourceAsset&amp;revision=2">B');
 expect(out).toContain('href="/a/Page/assets?dependency=SourceAsset&amp;revision=2">G');
 for(const kept of ['href="/assets/source.pdf"','href="https://x.test/assets/source.pdf"','href="./assets/other.pdf"','href="%E0%A4%A"'])expect(out).toContain(kept);
 expect(rewriteNativeRuntimePdfLinks(html,'Page',[])).toBe(html);
});
