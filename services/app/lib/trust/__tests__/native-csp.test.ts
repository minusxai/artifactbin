import {expect,it} from 'vitest';
import {nativeCspDeclarations} from '../native-csp';
const page=(head:string,body='')=>`<!doctype html><html><head>${head}</head><body>${body}</body></html>`;
it('reads only actual head metadata, decoding HTML attributes without interpreting scripts or templates',()=>{
 const result=nativeCspDeclarations(page('<meta name="csp-connect" content="https://API.example.com/"><script>"<meta name=csp-script content=https://evil.test>"</script><template><meta name="csp-media" content="https://evil.test"></template>','<meta name="csp-img" content="https://evil.test">'));
 expect(result.ok).toBe(true);
 expect(result.extensions).toEqual({connect:['https://api.example.com'],script:[],style:[],img:[],frame:[],media:[]});
});
it('never admits insecure origins, credentials, paths or header injection and caps each directive',()=>{
 const result=nativeCspDeclarations(page('<meta name="csp-script" content="http://evil.test https://user:pass@example.com https://example.com/path https://good.example.com;">'));
 expect(result.ok).toBe(false);expect(result.extensions.script).toEqual([]);
 const capped=nativeCspDeclarations(page(`<meta name="csp-connect" content="${Array.from({length:11},(_,i)=>`https://host${i}.example.com`).join(' ')}">`));
 expect(capped.ok).toBe(false);expect(capped.extensions.connect).toHaveLength(10);
});
it('retains directive allowlist and canonical wildcard origins',()=>{
 const result=nativeCspDeclarations(page('<meta name="csp-style" content="https://*.example.com"><meta name="csp-default" content="https://evil.test">'));
 expect(result.ok).toBe(false);expect(result.extensions.style).toEqual(['https://*.example.com']);
 expect(result.extensions).not.toHaveProperty('default');
});

it('rejects duplicate policy declarations rather than silently changing which hosts consent covers',()=>{
 const result=nativeCspDeclarations(page('<meta name="csp-script" content="https://one.example.com"><meta name="csp-script" content="https://two.example.com">'));
 expect(result.ok).toBe(false);
});
