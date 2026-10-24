import { expect, it } from 'vitest';
import { serializePortableCopy } from '../browser-portable';
import { portableScript } from '../portable';
import { readPortableDocument } from '../portable';
it('saves original authored nodes instead of overlays, credentials, comments or mutated DOM',()=>{
 const source='<html><body><h1 data-af-id="title">Original</h1></body></html>';
 document.head.innerHTML='<script data-af="runtime" type="application/json">{"offline":true,"pageId":"p","backends":[]}</script><script data-af="apollo" type="application/json">"module"</script><script data-af="reader" type="application/json">"reader"</script><script data-af="core">boot()</script>';
 document.body.innerHTML='<h1>Mutated</h1><aside>Private live comment</aside><input value="credential">';
 const output=serializePortableCopy({document,sourceBytes:portableScript({version:1,source})+source,portable:{version:1,source},privateState:{filter:'mine'}});
 expect(output).toContain('data-af-id="title">Original');
 expect(output).not.toContain('Mutated');expect(output).not.toContain('Private live comment');expect(output).not.toContain('credential');
 expect(readPortableDocument(output)).toEqual({version:1,source,privateState:{filter:'mine'}});
 const reopened=new DOMParser().parseFromString(output,'text/html');
 expect(serializePortableCopy({document:reopened,sourceBytes:output,portable:readPortableDocument(output),privateState:{filter:'mine'}})).toBe(output);
});
it('saves a newly published session identity without mutating the live source or reusing the local runtime identity',()=>{
 const source='<html><head><link rel="af-dataset" data-af-name="orders" href="ref:ABC123"></head><body><h1 data-af-id="title">Title</h1></body></html>';
 const identity={platformOrigin:'https://platform.example',artifactId:'p',baseRevision:'3',sourceDigest:'a'.repeat(64)};
 document.head.innerHTML='<script data-af="runtime" type="application/json">{"pageId":"local:file","revision":"local","backends":[]}</script><script data-af="apollo" type="application/json">"module"</script><script data-af="reader" type="application/json">"reader"</script><script data-af="core">boot()</script>';
 const output=serializePortableCopy({document,sourceBytes:source,portable:{version:1,source,identity}});
 const copied=new DOMParser().parseFromString(output,'text/html');
 expect(JSON.parse(copied.querySelector('[data-af="runtime"]')!.textContent!)).toMatchObject({pageId:'p',revision:'3',backends:['orders'],bindings:{orders:'ABC123'},savedNodeIds:['title']});
 expect(JSON.parse(document.querySelector('[data-af="runtime"]')!.textContent!).pageId).toBe('local:file');
});
it('adopts normalized publication identities only on explicit save of unchanged selected author bytes',async()=>{
 const {sha256Hex}=await import('@artifactbin/utils/sha256');
 const source='<html><head></head><body><h1>Original</h1></body></html>';
 const canonical='<html data-af-id="root"><head data-af-id="head"></head><body data-af-id="body"><h1 data-af-id="heading">Original</h1></body></html>';
 document.head.innerHTML='<script data-af="runtime" type="application/json">{"pageId":"local:file","revision":"local","backends":[]}</script><script data-af="apollo" type="application/json">"module"</script><script data-af="reader" type="application/json">"reader"</script><script data-af="core">boot()</script>';
 const publishedSource={source:canonical,localSourceDigest:sha256Hex(source)};
 const saved=serializePortableCopy({document,sourceBytes:source,portable:{version:1,source},publishedSource});
 expect(readPortableDocument(saved).source).toBe(canonical);
 expect(new DOMParser().parseFromString(saved,'text/html').querySelector('h1')?.getAttribute('data-af-id')).toBe('heading');
 const edited=source.replace('Original','Edited after publication');
 const preserved=serializePortableCopy({document,sourceBytes:edited,portable:{version:1,source},publishedSource});
 expect(readPortableDocument(preserved).source).toBe(edited);
 expect(new DOMParser().parseFromString(preserved,'text/html').querySelector('h1')?.getAttribute('data-af-id')).toBeNull();
});
