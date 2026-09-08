import {afterEach,describe,expect,it,vi} from 'vitest';
import {MANAGED_FETCH_BOOTSTRAP} from '../managed-fetch-bootstrap';
import {managedAuthorDocument} from '../managed-iframe';

afterEach(()=>vi.unstubAllGlobals());

describe('managed local asset reads',()=>{
  it('reads local blob/data URLs natively without crossing the asset relay',async()=>{
    const native=vi.fn(async()=>new Response(new Uint8Array([1,2,3]),{headers:{'content-type':'application/octet-stream'}}));
    vi.stubGlobal('fetch',native);
    const request=vi.fn(),report=vi.fn();
    const install=new Function('request','report',`${MANAGED_FETCH_BOOTSTRAP}; return window.fetch;`) as (request:unknown,report:unknown)=>typeof fetch;
    const managedFetch=install(request,report);
    const response=await managedFetch('blob:null/embedded-texture');
    expect([...new Uint8Array(await response.arrayBuffer())]).toEqual([1,2,3]);
    expect(native).toHaveBeenCalledWith('blob:null/embedded-texture',expect.objectContaining({method:'GET',credentials:'omit',redirect:'error'}));
    expect(request).not.toHaveBeenCalled();
  });

  it('keeps local reads credential-free and admits them in the inner CSP',async()=>{
    vi.stubGlobal('fetch',vi.fn());
    const install=new Function('request','report',`${MANAGED_FETCH_BOOTSTRAP}; return window.fetch;`) as (request:unknown,report:unknown)=>typeof fetch;
    const managedFetch=install(vi.fn(),vi.fn());
    await expect(managedFetch('data:text/plain,secret',{credentials:'include'})).rejects.toThrow('credential-free GET');
    expect(managedAuthorDocument('https://assets.example')).toContain('connect-src https://assets.example blob: data:');
  });
});
