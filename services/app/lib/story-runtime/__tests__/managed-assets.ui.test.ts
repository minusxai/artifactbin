import {afterEach,describe,it,expect,vi} from 'vitest';
import {createManagedAssetResolver,prepareManagedContent} from '../managed-assets';
afterEach(()=>vi.unstubAllGlobals());
describe('managed asset adapter',()=>{
  it('prepares a bookshelf with bounded parallel requests, preserving document and script order',async()=>{
    vi.useFakeTimers();
    let active=0,peak=0;
    const resolver={dispose:vi.fn(),resolve:vi.fn(async(url:string)=>{
      active++;peak=Math.max(peak,active);
      await new Promise(resolve=>setTimeout(resolve,10));active--;
      return 'https://assets.example/'+encodeURIComponent(url);
    })};
    try {
      const html=Array.from({length:58},(_,i)=>`<img src="https://cdn.example/${i}.png">`).join('');
      const prepared=prepareManagedContent({html,scripts:[{type:'classic',src:'https://cdn.example/first.js'},{type:'classic',src:'https://cdn.example/second.js'}]},resolver,document);
      await vi.runAllTimersAsync();
      const result=await prepared;
      expect(peak).toBeGreaterThan(1);expect(peak).toBeLessThanOrEqual(8);
      expect(result.html.indexOf('0.png')).toBeLessThan(result.html.indexOf('57.png'));
      expect(result.scripts.map(s=>s.src)).toEqual(['https://assets.example/https%3A%2F%2Fcdn.example%2Ffirst.js','https://assets.example/https%3A%2F%2Fcdn.example%2Fsecond.js']);
      expect(resolver.resolve).toHaveBeenCalledTimes(60);
    } finally {vi.useRealTimers();}
  });
  it('uses trusted relay for private previews without exposing export key or fetching directly',async()=>{
    const fetch=vi.fn();vi.stubGlobal('fetch',fetch);
    const relay=vi.fn(async()=>({url:'https://assets.example/assets/'+'a'.repeat(64)}));
    const resolver=createManagedAssetResolver({origin:'https://assets.example',resolveUrl:'https://app.example/a/def456/assets?key=scoped'},relay);
    await resolver.resolve('https://cdn.example/bundle.js','script');
    expect(relay).toHaveBeenCalledExactlyOnceWith('https://cdn.example/bundle.js','script',expect.any(AbortSignal));expect(fetch).not.toHaveBeenCalled();resolver.dispose();
  });
  it('resolves public refs without caching aliases and preserves platform export keys',async()=>{
    const fetch=vi.fn(async(_url:string)=>new Response(JSON.stringify({url:'https://assets.example/assets/ref/abc123'})));vi.stubGlobal('fetch',fetch);
    const resolver=createManagedAssetResolver({origin:'https://assets.example',resolveUrl:'https://app.example/a/def456/assets?key=scoped'});
    expect(await resolver.resolve('ref:abc123','image')).toBe('https://assets.example/assets/ref/abc123');
    await resolver.resolve('ref:abc123','image');expect(fetch).toHaveBeenCalledTimes(2);
    expect(fetch.mock.calls[0][0]).toContain('key=scoped');resolver.dispose();
  });
  it('does not import cached URLs again and never accepts other paths on asset host',async()=>{
    const fetch=vi.fn(async()=>new Response(JSON.stringify({url:'https://assets.example/api/account'})));vi.stubGlobal('fetch',fetch);
    const resolver=createManagedAssetResolver({origin:'https://assets.example',resolveUrl:'https://app.example/a/abc123/assets'});
    const cached='https://assets.example/assets/'+'a'.repeat(64);
    expect(await resolver.resolve(cached,'binary')).toBe(cached);expect(fetch).not.toHaveBeenCalled();
    await expect(resolver.resolve('https://cdn.example/file','binary')).rejects.toThrow();resolver.dispose();
  });
  it('keeps hyperlinks intact and resolves media/CSS fonts as generic assets',async()=>{
    const resolver={resolve:vi.fn(async()=> 'https://assets.example/assets/'+'a'.repeat(64)),dispose:vi.fn()};
    const result=await prepareManagedContent({html:'<a href="https://example.com">Link</a><video src="https://cdn.example/video"/><style>@font-face{font-family:A;src:url(https://cdn.example/font)}</style>',scripts:[]},resolver,document);
    expect(result.html).toContain('href="https://example.com"');
    expect(resolver.resolve).toHaveBeenCalledWith('https://cdn.example/video','binary');
    expect(resolver.resolve).toHaveBeenCalledWith('https://cdn.example/font','binary');
  });
  it('resolves and caches only validated asset-origin JSON addresses',async()=>{
    const cached='https://assets.example/assets/'+'a'.repeat(64);
    const fetch=vi.fn(async()=>new Response(JSON.stringify({url:cached})));
    vi.stubGlobal('fetch',fetch);
    const resolver=createManagedAssetResolver({origin:'https://assets.example',resolveUrl:'https://app.example/a/abc123/assets'});
    expect(await resolver.resolve('https://cdn.example/a.js','script')).toBe(cached);
    await resolver.resolve('https://cdn.example/a.js','script');expect(fetch).toHaveBeenCalledTimes(1);
    expect(fetch.mock.calls[0]).toEqual([expect.stringContaining('kind=script'),expect.objectContaining({redirect:'error',headers:{Accept:'application/json'}})]);
    resolver.dispose();await expect(resolver.resolve('https://cdn.example/a.js','script')).rejects.toThrow();
  });
  it('fails closed without configuration and rejects wrong returned origins and refs',async()=>{
    await expect(createManagedAssetResolver().resolve('https://cdn.example/a.js','script')).rejects.toThrow();
    vi.stubGlobal('fetch',vi.fn(async()=>new Response(JSON.stringify({url:'https://evil.example/a'}))));
    const resolver=createManagedAssetResolver({origin:'https://assets.example',resolveUrl:'https://app.example/a/abc123/assets'});
    await expect(resolver.resolve('https://cdn.example/a.js','script')).rejects.toThrow();
    await expect(resolver.resolve('ref:abc123','image')).rejects.toThrow();resolver.dispose();
  });
  it('rewrites inert DOM/CSS and all script URLs before returning, preserves inline script bytes',async()=>{
    const resolver={resolve:vi.fn(async(url:string)=>'https://assets.example/'+encodeURIComponent(url)),dispose:vi.fn()};
    const content={html:'<img src="https://cdn.example/a.png"><style>p{background:url("https://cdn.example/a.png")}</style>',scripts:[{type:'classic' as const,src:'https://cdn.example/a.js'},{type:'classic' as const,source:'const x="</script>"'}]};
    const result=await prepareManagedContent(content,resolver,document);
    expect(result.html).not.toContain('src="https://cdn.example');
    expect(result.html).toContain('https://assets.example/');
    expect(result.scripts[0].src).toContain('https://assets.example/');
    expect(result.scripts[1].source).toBe(content.scripts[1].source);
    expect(document.querySelector('img,style,script')).toBeNull();
  });
  it('keeps data-image commas intact while rewriting multiple srcset candidates',async()=>{
    const resolver={resolve:vi.fn(async(url:string)=>'https://assets.example/'+encodeURIComponent(url)),dispose:vi.fn()};
    const result=await prepareManagedContent({html:'<img srcset="data:image/png;base64,AAAA 1x, https://cdn.example/two.png 2x">',scripts:[]},resolver,document);
    expect(result.html).toContain('data:image/png;base64,AAAA 1x');
    expect(result.html).toContain('https://assets.example/https%3A%2F%2Fcdn.example%2Ftwo.png 2x');
    expect(resolver.resolve).toHaveBeenCalledTimes(1);
  });
  it('keeps a descriptor-less srcset candidate separate from the next one',async()=>{
    const resolver={resolve:vi.fn(async(url:string)=>'https://assets.example/'+encodeURIComponent(url)),dispose:vi.fn()};
    const result=await prepareManagedContent({html:'<img srcset="https://cdn.example/one.png, https://cdn.example/two.png 2x">',scripts:[]},resolver,document);
    expect(result.html).toContain('one.png, https://assets.example/https%3A%2F%2Fcdn.example%2Ftwo.png 2x');
    expect(resolver.resolve).toHaveBeenCalledTimes(2);
  });
});
