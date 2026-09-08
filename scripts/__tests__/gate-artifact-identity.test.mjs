import {it,expect,vi} from 'vitest';
import {JSDOM} from 'jsdom';
import {readArtifactBootstrapId,hasCommentPermission} from '../lib/gate-artifact-identity.mjs';
it('reads the actual bootstrap artifact identity, never the canonical slug or an authored duplicate',()=>{
 const dom=new JSDOM('<head><script id="mx-page-data" type="application/json">{"artifact":{"surface":{"id":"ABC123"}}}</script></head><body><div id="mx-page-data">{"artifact":{"surface":{"id":"forged"}}}</div></body>',{url:'https://main.test/@owner/ABC123-my-slug'});
 expect(readArtifactBootstrapId(dom.window.document)).toBe('ABC123');
 dom.window.document.head.replaceChildren();expect(()=>readArtifactBootstrapId(dom.window.document)).toThrow(/bootstrap/);dom.window.close();
});
it('uses the supplied fixture id and browser marker for permission reads',async()=>{
 const fetch=vi.fn(async()=>({ok:true,json:async()=>({role:'commenter'})}));vi.stubGlobal('fetch',fetch);
 try{expect(await hasCommentPermission({evaluate:(fn,id)=>fn(id)},'ABC123')).toBe(true);
 expect(fetch).toHaveBeenCalledWith('/api/page/artifact/ABC123',{headers:{'x-artifactbin-csrf':'1'}});
 }finally{vi.unstubAllGlobals();}
});
