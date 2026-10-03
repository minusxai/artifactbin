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

it('hands a redirect to another session origin back unfollowed, and still refuses every other origin', async () => {
  const pages = (url: URL) => url.hostname.endsWith('.lvh.me');
  const seen: string[] = [];
  const response = await sessionRequest(new Request('http://lvh.me/pages-session?ticket=t'), async request => {
    seen.push(request.url);
    return new Response(null, {status:302,headers:{location:'http://646f6331.lvh.me/','set-cookie':'afbin_pages=c; Domain=.lvh.me'}});
  }, pages);
  // The page itself goes there: following it here would leave the frame on the apex's origin.
  expect(response.status).toBe(302);
  expect(response.headers.get('location')).toBe('http://646f6331.lvh.me/');
  expect(seen).toEqual(['http://lvh.me/pages-session?ticket=t']);
  await expect(sessionRequest(new Request('http://lvh.me/pages-session'), async () => new Response(null,{status:302,headers:{location:'https://elsewhere.test/'}}), pages)).rejects.toThrow(/origin/);
  await expect(sessionRequest(new Request('http://lvh.me/pages-session'), async () => new Response(null,{status:302,headers:{location:'http://user:pw@646f6331.lvh.me/'}}), pages)).rejects.toThrow(/origin/);
});
