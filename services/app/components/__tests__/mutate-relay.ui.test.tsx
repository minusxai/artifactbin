import {beforeEach,afterEach,it,expect,vi} from 'vitest';
import {act,screen} from '@testing-library/react';
import {render} from '@/test/helpers/surface-ui';
import {setupSurface,surfaceProps} from '@/test/helpers/inline-surface';
import ArtifactSurface from '../ArtifactSurface';
import {createAuthenticatedTransport} from '@/lib/story-runtime/authenticated-transport';
beforeEach(setupSurface);afterEach(()=>vi.unstubAllGlobals());
it('sends named mutations, row and local table snapshots using same-origin authentication',async()=>{
 const fetcher=vi.fn(async()=>new Response(JSON.stringify({ok:true,dataset:'data123'})));
 const transport=createAuthenticatedTransport('story1',fetcher);
 await expect(transport.mutate!({choice:'tacos'},'vote',{id:1},{cart:[{id:1}]})).resolves.toEqual({dataset:'data123'});
 expect(fetcher).toHaveBeenCalledWith('/a/story1/mutate',expect.objectContaining({credentials:'same-origin',body:JSON.stringify({values:{choice:'tacos'},mutation:'vote',row:{id:1},localTables:{cart:[{id:1}]}})}));
 transport.dispose();
});
it('reports the server ACL refusal instead of pretending the write succeeded',async()=>{
 const transport=createAuthenticatedTransport('story1',vi.fn(async()=>new Response(JSON.stringify({error:'dataset_read_only',detail:'not open for writes'}),{status:403})));
 await expect(transport.mutate!({},'vote')).rejects.toThrow('not open for writes');transport.dispose();
});
it('ignores mutation and asset messages from unrelated or author windows',async()=>{
 const fetcher=vi.fn(async()=>Response.json({stars:null}));vi.stubGlobal('fetch',fetcher);
 render(<ArtifactSurface {...surfaceProps()} />);await screen.findByText('Document body');
 // The chrome may fetch its GitHub count on mount; forged messages must make no further requests.
 fetcher.mockClear();
 await act(async()=>{for(const type of ['mx:mutate','mx:asset'])window.dispatchEvent(new MessageEvent('message',{source:window,data:{type,id:1,mutation:'vote',values:{},url:'https://example.com'}}));});
 expect(fetcher).not.toHaveBeenCalled();
});
