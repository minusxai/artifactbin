/**
 * THE PAGE'S OWN FETCH (./page-fetch, installed by core before any author script): a fetch of a file published with
 * the page reads that file, a GET to a declared host goes through the page's fetch door, and every other fetch reaches
 * the browser's own fetch with the very arguments it was given.
 */
import {afterEach,beforeEach,describe,expect,it,vi} from 'vitest';
import {installPageFetch} from '../page-fetch';

let uninstall:()=>void;
let native:ReturnType<typeof vi.fn>;
beforeEach(()=>{
 native=vi.fn(async()=>new Response('native'));
 window.fetch=native as unknown as typeof fetch;
 uninstall=installPageFetch(window);
});
afterEach(()=>uninstall());

describe('a fetch the page does not name is the browser\'s own',()=>{
 it.each([
  ['an external origin','https://api.example.com/fn/items'],
  ['an external origin URL object',new URL('https://api.example.com/fn/items')],
  ['another path on this origin','/api/data.json'],
  ['a /fn/ path on this origin: there are no page functions','/fn/items'],
  ['a dot segment','/fn/../graphql'],
 ])('%s goes to the native fetch with the same arguments',async(_label,input)=>{
  const init={method:'POST',body:'x',credentials:'include' as const};
  const response=await window.fetch(input as string,init);
  expect(await response.text()).toBe('native');
  expect(native).toHaveBeenCalledTimes(1);
  expect(native.mock.calls[0]![0]).toBe(input);expect(native.mock.calls[0]![1]).toBe(init);
 });
 it('a native rejection (CSP, network) reaches the caller unchanged',async()=>{
  const refusal=new TypeError('Failed to fetch');native.mockRejectedValueOnce(refusal);
  await expect(window.fetch('https://blocked.example/x')).rejects.toBe(refusal);
 });
 it('uninstalling restores the native fetch',()=>{
  uninstall();
  expect(window.fetch).toBe(native);
  uninstall=()=>{};
 });
});

it('does not coerce a fetch input twice',async()=>{
 let coercions=0;
 const input={toString(){coercions++;return 'https://api.example.com/data';}};
 native.mockImplementationOnce(async(value:unknown)=>{String(value);return new Response('native');});
 await window.fetch(input as unknown as string);
 expect(coercions).toBe(1);
});

it('proxy input failures reject asynchronously like native fetch',async()=>{
 const {proxy,revoke}=Proxy.revocable({},{});revoke();
 let result:Promise<Response>|undefined;
 expect(()=>{result=window.fetch(proxy as unknown as string);}).not.toThrow();
 await expect(result).rejects.toBeInstanceOf(TypeError);
});

/**
 * A file published with the page (`files`, the runtime config's table, lib/html-publication-bundle): a fetch of the path
 * the author wrote goes to the native fetch at the file's address; a path the publication did not record is untouched.
 */
describe('a file published with the page is fetched by its path',()=>{
 const ADDRESS='/a/PAGE12/assets?dependency=DATA12&revision=1&version=3';
 const at=(address:string)=>new URL(address,document.baseURI).href;
 beforeEach(()=>{uninstall();uninstall=installPageFetch(window,{'data.json':ADDRESS,'geo/states.geojson':'/a/PAGE12/assets?dependency=GEO123&revision=2&version=3','my%20file.json':'data:application/json;base64,e30='});});
 it.each([
  ['the relative path','./data.json'],
  ['the bare name','data.json'],
  ['a dot segment that lands on it','./geo/../data.json'],
  ['a query and a hash, which the stored file does not vary by','./data.json?v=2#rows'],
  ['an absolute URL on this origin',new URL('./data.json',document.baseURI).href],
  ['a URL object built from the document',new URL('./data.json',document.baseURI)],
 ])('%s goes to its address, with the same init',async(_label,input)=>{
  const init={headers:{accept:'application/json'}};
  await window.fetch(input as string,init);
  expect(native).toHaveBeenCalledTimes(1);
  expect(native.mock.calls[0]![0]).toBe(at(ADDRESS));expect(native.mock.calls[0]![1]).toBe(init);
 });
 it('a nested path and a name the URL parser encodes reach theirs; an offline copy\'s data: address is used as given',async()=>{
  await window.fetch('./geo/states.geojson');expect(native.mock.calls[0]![0]).toBe(at('/a/PAGE12/assets?dependency=GEO123&revision=2&version=3'));
  await window.fetch('./my file.json');expect(native.mock.calls[1]![0]).toBe('data:application/json;base64,e30=');
 });
 it('a Request keeps its method, headers and signal at the new address',async()=>{
  const controller=new AbortController();
  await window.fetch(new Request(new URL('./data.json',document.baseURI),{headers:{'x-page':'1'},signal:controller.signal}));
  const sent=native.mock.calls[0]![0] as Request;
  expect(sent).toBeInstanceOf(Request);expect(sent.url).toBe(at(ADDRESS));expect(sent.method).toBe('GET');expect(sent.headers.get('x-page')).toBe('1');
  controller.abort();expect(sent.signal.aborted).toBe(true);
 });
 it.each([
  ['a path the publication did not record','./other.json'],
  ['a recorded name in another folder','./sub/data.json'],
  ['a recorded name on another origin','https://cdn.example/data.json'],
 ])('%s goes to the native fetch untouched',async(_label,input)=>{
  const init={method:'GET'};
  await window.fetch(input,init);
  expect(native.mock.calls[0]![0]).toBe(input);expect(native.mock.calls[0]![1]).toBe(init);
 });
});

describe('a host the page declares in csp-connect is reached through its own fetch door',()=>{
 const door=(url:string)=>new URL(`/a/PAGE12/fetch?url=${encodeURIComponent(url)}`,document.baseURI).href;
 beforeEach(()=>{uninstall();uninstall=installPageFetch(window,undefined,{pageId:'PAGE12',origins:['https://api.example.com','https://*.tiles.example.org']});});
 it.each([
  ['a declared origin','https://api.example.com/v1/rates?base=eur'],
  ['a URL object','https://api.example.com/v1/rates'],
  ['a host under a declared wildcard','https://a.tiles.example.org/3/4/5.png'],
 ])('a GET to %s goes to the door, keeping its signal',async(_label,input)=>{
  const controller=new AbortController();
  await window.fetch(_label==='a URL object'?new URL(input):input,{signal:controller.signal});
  expect(native).toHaveBeenCalledTimes(1);
  expect(native.mock.calls[0]![0]).toBe(door(input));
  expect((native.mock.calls[0]![1] as RequestInit).signal).toBe(controller.signal);
 });
 it.each([
  ['an undeclared host','https://evil.example.net/x',undefined],
  ['the wildcard\'s own apex','https://tiles.example.org/x',undefined],
  ['a POST to a declared host','https://api.example.com/v1/rates',{method:'POST',body:'{}'}],
 ])('%s goes to the native fetch untouched',async(_label,input,init)=>{
  await window.fetch(input,init);
  expect(native.mock.calls[0]![0]).toBe(input);expect(native.mock.calls[0]![1]).toBe(init);
 });
});
