import {it,expect,vi} from 'vitest';
import {DOMAIN_READ_ONLY_MESSAGE} from '@artifactbin/contracts/domain-footer';
import {createDomainReadTransport} from '../domain-reads';
import {RemoteUnreachable} from '../apollo/apollo-contracts';
const location={href:'https://blog.example.org/abc123-sales?x=1'};
it('posts reads to the page\'s own host as a signed-out viewer, naming the current revision, with no preflight',async()=>{
 const send=vi.fn<typeof fetch>(async()=>new Response(JSON.stringify({data:{sales:{count:2}}}))),page={pageId:'abc123',revision:'3'};
 const port=createDomainReadTransport(page,location,send);
 expect(port.online()).toBe(true);
 expect(await port.execute({query:'{sales{count}}',variables:{},operation:'query'})).toEqual({data:{sales:{count:2}}});
 const [url,init]=send.mock.calls[0]!;
 expect(String(url)).toBe('https://blog.example.org/api/artifacts/abc123/graphql');
 expect(init).toMatchObject({method:'POST',credentials:'omit',redirect:'error',headers:{'content-type':'text/plain;charset=UTF-8'}});
 expect(JSON.parse(String(init!.body))).toEqual({query:'{sales{count}}',variables:{},operation:'query',revision:'3'});
 page.revision='4';await port.execute({query:'{sales{count}}',variables:{},operation:'query'});
 expect(JSON.parse(String(send.mock.calls[1]![1]!.body)).revision).toBe('4');
});
it('never sends a write, and reports a refusal or an unreachable host the way the client expects',async()=>{
 const send=vi.fn<typeof fetch>(async()=>new Response(JSON.stringify({error:'not_found'}),{status:404}));
 const port=createDomainReadTransport({pageId:'abc123',revision:'1'},location,send);
 expect(await port.execute({query:'mutation{counter{add}}',variables:{},operation:'mutation'})).toEqual({data:null,errors:[{message:DOMAIN_READ_ONLY_MESSAGE}]});
 expect(send).not.toHaveBeenCalled();
 expect(await port.execute({query:'{counter{count}}',variables:{},operation:'query'})).toEqual({data:null,errors:[{message:'not_found'}]});
 const down=createDomainReadTransport({pageId:'abc123',revision:'1'},location,async()=>{throw new TypeError('Failed to fetch');});
 await expect(down.execute({query:'{counter{count}}',variables:{},operation:'query'})).rejects.toBeInstanceOf(RemoteUnreachable);
});
