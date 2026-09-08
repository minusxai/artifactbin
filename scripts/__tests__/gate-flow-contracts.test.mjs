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
