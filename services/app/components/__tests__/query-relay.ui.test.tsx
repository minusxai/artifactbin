/** Inline documents call an instance-owned transport; window messages have no API authority. */
import {beforeEach,afterEach,it,expect,vi} from 'vitest';
import {act,screen} from '@testing-library/react';
import {render} from '@/test/helpers/surface-ui';
import {setupSurface,surfaceProps} from '@/test/helpers/inline-surface';
import ArtifactSurface from '../ArtifactSurface';
import {createAuthenticatedTransport} from '@/lib/story-runtime/authenticated-transport';
beforeEach(setupSurface);afterEach(()=>vi.unstubAllGlobals());
it('sends query values and local tables through the authenticated document door',async()=>{
 const fetcher=vi.fn(async()=>new Response(JSON.stringify({tables:{sales:{rows:[{a:1}],columns:[]}},errors:{}})));
 const transport=createAuthenticatedTransport('story1',fetcher);
 const result=await transport.run({region:'EU'},['sales'],{cart:[{id:1}]});
 expect(result.tables.sales.rows).toEqual([{a:1}]);
 expect(fetcher).toHaveBeenCalledWith('/a/story1/query',expect.objectContaining({credentials:'same-origin',body:JSON.stringify({values:{region:'EU'},only:['sales'],localTables:{cart:[{id:1}]}})}));
 transport.dispose();
});
it('surfaces query refusal and revokes requests when the document is disposed',async()=>{
 const fetcher=vi.fn(async()=>new Response(JSON.stringify({error:'private_document'}),{status:403}));
 const transport=createAuthenticatedTransport('story1',fetcher);
 await expect(transport.run({},['sales'])).rejects.toThrow('private_document');
 transport.dispose();await expect(transport.run({},['sales'])).rejects.toThrow();
 expect(fetcher).toHaveBeenCalledTimes(1);
});
it('does not expose a query relay to any window, even one forging the previous protocol',async()=>{
 const fetcher=vi.fn(async()=>new Response(JSON.stringify({count:null})));vi.stubGlobal('fetch',fetcher);
 render(<ArtifactSurface {...surfaceProps()} />);await screen.findByText('Document body');
 await act(async()=>{for(const source of [null,window])window.dispatchEvent(new MessageEvent('message',{source,data:{type:'mx:query',id:7,values:{},only:['private']}}));});
 expect(fetcher.mock.calls.filter(call => (call as unknown[])[0] !== '/api/github-stars')).toHaveLength(0);
});
