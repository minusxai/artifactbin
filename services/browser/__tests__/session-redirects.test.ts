import { expect, it } from 'vitest';
import { sessionRequest } from '../src/session-redirects';

it('resolves canonical page redirects within the broker', async () => {
  const seen: string[] = [];
  const response = await sessionRequest(new Request('http://app/a/abc123'), async request => {
    seen.push(request.url);
    return seen.length === 1 ? new Response(null, {status:302,headers:{location:'/@owner/report'}}) : new Response('artifact');
  });
  expect(await response.text()).toBe('artifact');
  expect(seen).toEqual(['http://app/a/abc123','http://app/@owner/report']);
});

it('rejects external redirects and loops without forwarding identity', async () => {
  let calls=0;
  await expect(sessionRequest(new Request('http://app/a/abc123'), async () => {
    calls++;return new Response(null,{status:302,headers:{location:'https://elsewhere.test/'}});
  })).rejects.toThrow(/origin/);
  expect(calls).toBe(1);
  await expect(sessionRequest(new Request('http://app/a/abc123'), async () => new Response(null,{status:302,headers:{location:'/a/abc123'}}))).rejects.toThrow(/redirect/i);
});

it('honors redirect method changes and preserves 307 write bodies', async () => {
  for(const status of [303,307]){
    let calls=0;
    const response=await sessionRequest(new Request('http://app/write',{method:'POST',body:'payload',headers:{'content-type':'text/plain'}}),async request=>{
      if(calls++===0){await request.text();return new Response(null,{status,headers:{location:'/result'}});}
      expect(request.method).toBe(status===303?'GET':'POST');
      expect(await request.text()).toBe(status===303?'':'payload');
      return new Response('done');
    });
    expect(await response.text()).toBe('done');
  }
});
