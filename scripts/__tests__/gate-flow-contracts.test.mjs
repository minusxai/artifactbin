import {it,expect,vi} from 'vitest';
import {toggleArtifactComments} from '../lib/reveal-chrome.mjs';
import {readFileSync} from 'node:fs';
it('targets the comments control inside its named dialog, not the floating duplicate',async()=>{
 const click=vi.fn(),getByLabel=vi.fn(()=>({click})),getByRole=vi.fn(()=>({getByLabel}));
 await toggleArtifactComments({getByRole});
 expect(getByRole).toHaveBeenCalledWith('dialog',{name:'Artifact controls',exact:true});
 expect(getByLabel).toHaveBeenCalledWith('Toggle comments',{exact:true});expect(click).toHaveBeenCalledOnce();
});
it('checks signed-in fixture identity via the validated session, not retired cookie names',()=>{
 for(const file of ['gate-collab-edit.mjs','gate-folders.mjs','gate-link-access.mjs','gate-visibility.mjs'])expect(readFileSync(new URL('../'+file,import.meta.url),'utf8')).not.toContain('/better-auth/.test');
});
it('authorizes only the mutation gate sharing setup, preserving its guest forgery probe',()=>{
 const gate=readFileSync(new URL('../gate-mutation-permissions.mjs',import.meta.url),'utf8');
 expect(gate).toContain('headers:browserGateHeaders(base),data:patch');
 expect(gate).toContain('guest.request.post(`${fixture.url}/mutate`,{data:');
});
it('does not wait for navigation before releasing the deliberately held OAuth approval',()=>{
 const helper=readFileSync(new URL('../lib/main-page-login.mjs',import.meta.url),'utf8');
 expect(helper).toContain("getByLabel('Approve connection').click({noWaitAfter:true})");
 expect(helper).toContain("assert.equal(page.url(),consent");
 expect(helper).toContain("release();await page.waitForURL");
 expect(helper).toContain("code_verifier:verifier");
});
it('receives the OAuth redirect at a real bounded loopback listener',()=>{
 const helper=readFileSync(new URL('../lib/main-page-login.mjs',import.meta.url),'utf8');
 expect(helper).toContain("callbackServer.listen(0,'127.0.0.1'");
 expect(helper).toContain('assert.equal(callbacks.length,1)');
 expect(helper).toContain('finally {await new Promise(resolve=>callbackServer.close(resolve));}');
 expect(helper).not.toContain("page.route('http://127.0.0.1:5498");
});
it('checks hidden author workers by attachment and the document-level worker mount',()=>{
 const data=readFileSync(new URL('../gate-dataflow.mjs',import.meta.url),'utf8');
 expect(data).toContain('wrapper.waitForSelector(\'iframe[title="Interactive artifact content"]\', {state:\'attached\'})');
 const app=readFileSync(new URL('../gate-app-flows.mjs',import.meta.url),'utf8');
 expect(app).toContain('document.querySelectorAll(\'iframe[title="Isolated artifact script"]\')');
 expect(app).toContain("probe.count===1 && !probe.unsafe");
});
it('stubs only thumbnail images in the fake-DNS auth fixture and preserves annotation Escape failure',()=>{
 const login=readFileSync(new URL('../lib/main-page-login.mjs',import.meta.url),'utf8');
 expect(login).toContain("request.resourceType()==='image'");expect(login).toContain("url.origin===base");
 expect(login).toContain("route.fulfill({status:200,contentType:'image/png'");
 const annotations=readFileSync(new URL('../gate-annotations.mjs',import.meta.url),'utf8');
 expect(annotations).toContain("'Escape dismisses artifact controls before interacting with the rail'");
 expect(annotations).toContain("getByLabel('Dismiss artifact controls',{exact:true}).click()");
});
it('keeps the navigation positive control executable only in a dedicated hash-authorized fixture',()=>{
 const gate=readFileSync(new URL('../gate-managed-iframe.mjs',import.meta.url),'utf8');
 expect(gate).toContain("page.goto(base+'/managed-positive-fixture')");
 expect(gate).toContain("createHash('sha256').update(positiveScript)");
 expect(gate).toContain("frame-src 'self'");
 expect(gate).toContain("nested author cannot navigate to first-party application origin");
 expect(gate).not.toContain("await page.evaluate(url=>{const frame=document.createElement('iframe')");
});
it('does not block token adoption on unrelated home image load completion',()=>{
 const helper=readFileSync(new URL('../lib/start-doc.mjs',import.meta.url),'utf8');
 expect(helper).toContain("page.goto(`${base}/`, { waitUntil: 'domcontentloaded' })");
 expect(helper).toContain("if (status !== 204) throw");
});
it('compares native and wrapped runtime frames by identity in the delayed query gate',()=>{
 const gate=readFileSync(new URL('../gate-late-controls-query.mjs',import.meta.url),'utf8');
 expect(gate).toContain('sameGateFrame(req.frame(),page.mainFrame())');
 expect(gate).not.toContain('assert.equal(req.frame(),page.mainFrame()');
});
it('scopes comment controls and separates copyable Share from owner-only ACL writes',()=>{
 const gate=readFileSync(new URL('../gate-link-access.mjs',import.meta.url),'utf8');
 expect(gate).toContain("strangerControls.getByLabel('Toggle comments',{exact:true})");
 expect(gate).toContain("strangerControls.getByLabel('Share',{exact:true})");
 expect(gate).toContain('aclWrite===403');
 expect(gate).toContain('[data-controls-region] [aria-label="Toggle comments"]');
 expect(gate).toContain('window.__gateLinkAccessOwnerIdentity');
});
it('requires live reader content in the main document while excluding an author document iframe',()=>{
 const gate=readFileSync(new URL('../gate-live-reader.mjs',import.meta.url),'utf8');
 expect(gate).toContain('host.ownerDocument===document && window===top');
 expect(gate).toContain('iframe[title="artifact"]');
 expect(gate).not.toContain('the reader gets the document itself, not the app shell');
});
