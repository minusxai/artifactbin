/** HTTP discovery remains app chrome; authored native page bytes stay their own file. */
import {expect,it} from 'vitest';
import {createAppServer} from '@/server/app';
import {agentDiscovery,agentDiscoveryHead,agentDiscoveryTail,withAgentDiscoveryTail} from '@/lib/serving/agent-discovery';

it('keeps author help available in the app shell on its request origin',async()=>{
 const app=createAppServer({indexHtml:async()=>'<html><head><title>App</title></head><body></body></html>'});
 const response=await app.request('https://app.example.test/login',{headers:{accept:'text/html'}});
 expect(response.status).toBe(200);
 const html=await response.text();
 const help=agentDiscovery('https://app.example.test');
 expect(html).toContain(agentDiscoveryHead(help));
 expect(html).toContain(agentDiscoveryTail(help));
});
it('places the discovery tail at the final body boundary',()=>{
 const help=agentDiscovery('https://app.example.test');
 const html='<html><body><script>const x="</body>"</script></body></html>';
 expect(withAgentDiscoveryTail(html,help)).toBe(html.replace('</body></html>',`${agentDiscoveryTail(help)}</body></html>`));
});
