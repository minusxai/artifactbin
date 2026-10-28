import { expect, it } from 'vitest';
import { readPortableDocument, portableScript, saveOriginal } from '../portable';

it('reopens exact canonical source and explicitly selected private state without executing delimiters', () => {
 const source='<!DOCTYPE html>\n<script>const x="</script>"</script><p data-af-id="stable">original</p>';
 const encoded=portableScript({version:1,source,privateState:{filter:'mine'}});
 expect(encoded).not.toContain(source);
 const reopened=readPortableDocument(encoded);
 expect(reopened).toEqual({version:1,source,privateState:{filter:'mine'}});
 expect(portableScript(reopened)).toBe(encoded);
});
it('reads a file envelope through the same allowlist, whatever the script tag case',()=>{
 const html='<!doctype html><SCRIPT type="application/json" data-af="portable">{"version":1,"source":"<p>x</p>","token":"secret","renderedDigest":"d"}</SCRIPT>';
 expect(readPortableDocument(html)).toEqual({version:1,source:'<p>x</p>',renderedDigest:'d'});
});
it('serializes an allowlisted envelope and rejects secret-bearing provenance URLs',()=>{
 expect(portableScript({version:1,source:'x',token:'secret'} as never)).not.toContain('secret');
 expect(()=>portableScript({version:1,source:'x',identity:{platformOrigin:'https://user:secret@example.test',artifactId:'p',baseRevision:'1',sourceDigest:'a'.repeat(64)}})).toThrow();
});
it('rejects stale original files without writing and writes only an explicitly supplied handle',async()=>{
 let disk='external';
 const port={read:async()=>disk,write:async(value:string)=>{disk=value;}};
 await expect(saveOriginal(port,'base','saved')).rejects.toThrow('changed');
 expect(disk).toBe('external');
 disk='base';await saveOriginal(port,'base','saved');expect(disk).toBe('saved');
});
it('uses edited file bytes instead of stale embedded canonical source and preserves stable identities',async()=>{
 const { recoverPortableSource }=await import('../portable-source');
 const { downloadableHtml }=await import('../index');
 const source='<!doctype html><html><head></head><body><h1 data-af-id="title">Original</h1></body></html>';
 const html=downloadableHtml({html:source,core:'boot()',apollo:'module',reader:'reader',config:{pageId:'p',revision:'1',backends:[]}});
 expect(recoverPortableSource(html)).toBe(source);
 const edited=html.replace('>Original</h1>','>Edited on disk</h1>');
 const recovered=recoverPortableSource(edited);
 expect(recovered).toContain('data-af-id="title">Edited on disk');
 expect(recovered).not.toContain('data-af="portable"');expect(recovered).not.toContain('boot()');
});
it('preserves canonical references while recognizing an unchanged offline asset-packed rendering',async()=>{
 const { recoverPortableSource }=await import('../portable-source');
 const { downloadableHtml }=await import('../index');
 const source='<html><head></head><body><h1 data-af-id="title">Title</h1><img src="ref:image"></body></html>';
 const rendered=source.replace('ref:image','data:image/png;base64,aGVsbG8=');
 const html=downloadableHtml({html:rendered,portable:{version:1,source},core:'boot()',apollo:'module',reader:'reader',config:{pageId:'p',revision:'1',backends:[]}});
 expect(recoverPortableSource(html)).toBe(source);
 expect(recoverPortableSource(html.replace('>Title</h1>','>Disk edit</h1>'))).toContain('>Disk edit</h1>');
});
