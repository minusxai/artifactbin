/** Native reading chrome is authored HTML; platform controls stay outside the
 * runner. Retired kit outline/scrolly synthesis is covered by authored navigation
 * and responsive geometry in gate-reading-geometry. */
import {expect,it} from 'vitest';
import {GET as raw} from '@/app/a/[id]/raw/route';
import {POST as create} from '@/app/api/artifacts/route';
import {mintAccountToken,request,useAppHarness} from './harness';
useAppHarness();
const html='<!doctype html><html><head><style>.table-scroll{overflow-x:auto}</style></head><body><nav aria-label="Contents"><a href="#how">How</a></nav><section id="how"><h2>How</h2><p>Details</p></section><div class="table-scroll"><table><tr><td>Value</td></tr></table></div></body></html>';
it.each(['','?chrome=0'])('keeps authored reading navigation/table rules in native delivery%s without platform chrome',async(query)=>{
 const token=await mintAccountToken('native-reading');const created=await create(request('/api/artifacts',{method:'POST',token:token.token,json:{html,visibility:'public'}}));expect(created.status).toBe(201);const page=await created.json();const response=await raw(request(`/a/${page.id}/raw${query}`),{params:Promise.resolve({id:page.id})});expect(response.status).toBe(200);const body=await response.text();expect(body).toContain('aria-label="Contents"');expect(body).toContain('href="#how"');expect(body).toContain('.table-scroll{overflow-x:auto}');expect(body).not.toMatch(/data-mx-reader-chrome|mx-reader-byline|data-mx-spa-idle/);
});
