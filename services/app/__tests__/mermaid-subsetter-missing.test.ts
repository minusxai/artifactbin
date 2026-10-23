/** Native authors publish their own SVG; missing retired JSX Mermaid font
 * subsetter dependencies cannot prevent native publication or serving. */
import {expect,it,vi} from 'vitest';
import {useAppHarness,request,mintAccountToken} from './harness';
import {POST as create} from '@/app/api/artifacts/route';
import {GET as raw} from '@/app/a/[id]/raw/route';
import {nativeHtml} from './native-html-fixture';
vi.mock('wawoff2',()=>{throw new Error('font subsetter unavailable')});
useAppHarness();
it('serves authored vector geometry and text without a platform Mermaid engine or font subsetter',async()=>{
 const token=await mintAccountToken('native-svg');const svg='<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 120 80" role="img" aria-label="Request flow"><path d="M0 0L120 80" stroke="currentColor"></path><text x="10" y="30">Request</text></svg>';
 const made=await create(request('/api/artifacts',{method:'POST',token:token.token,json:{html:nativeHtml(svg),visibility:'public'}}));expect(made.status).toBe(201);const {id}=await made.json();const response=await raw(request(`/a/${id}/raw`),{params:Promise.resolve({id})});expect(response.status).toBe(200);const html=await response.text();expect(html).toContain('viewBox="0 0 120 80"');expect(html).toContain('>Request</text>');expect(html).toContain('d="M0 0L120 80"');expect(html).not.toContain('/assets/mermaid/');expect(html).not.toContain('id="mx-story-data"');
});
