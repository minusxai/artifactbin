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
