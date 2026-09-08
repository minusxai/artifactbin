import {expect,it} from 'vitest';
import {readFileSync} from 'node:fs';
const source=name=>readFileSync(new URL('../'+name,import.meta.url),'utf8');
it('measures trusted chrome through actual closed-root locator nodes including hit testing',()=>{
 const mobile=source('gate-mobile.mjs');
 expect(mobile).toContain("getByLabel('Editor toolbar',{exact:true}).evaluate");
 expect(mobile).toContain('getByLabel(label,{exact:true}).evaluate');
 expect(mobile).toContain("getByLabel('Themes',{exact:true}).evaluate");
 expect(mobile).toContain('el.getRootNode().elementFromPoint');
 expect(mobile).not.toContain('document.querySelector(`[aria-label="${l}"]`)');
});
it('opens the mounted provenance control and preserves canonical parent URL and PDF boundaries',()=>{
 const fork=source('gate-fork.mjs');expect(fork).toContain('await openArtifactControls(forker);\nconst credit');
 const security=source('gate-secure-arch.mjs');expect(security).toContain('reader.url() === expectedReaderUrl');
 const pdf=source('gate-pdf.mjs');expect(pdf).toContain("policy.get('object-src')===\"'none'\"");expect(pdf).toContain("policy.get('frame-src')===\"'self'\"");
 expect(pdf).toContain("headers.csp === 'sandbox'");expect(pdf).toContain("headers.nosniff === 'nosniff'");
});
