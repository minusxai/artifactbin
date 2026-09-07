import {describe,it,expect} from 'vitest';
import {parseJsx,type JsxElement} from '@/lib/jsx';
import {compileManagedIframe} from '../managed-iframe';
const compile=(source:string)=>{const parsed=parseJsx(source);if(!parsed.ok)throw new Error(parsed.error);return compileManagedIframe(parsed.nodes[0] as JsxElement);};
describe('managed Iframe inert compiler',()=>{
  it('separates executable scripts from inner DOM in document order',()=>{
    const result=compile('<Iframe><canvas id="pond"/><script src="https://cdn.example/bundle.js"/><script>{`window.started=true`}</script></Iframe>');
    expect(result.html).toContain('<canvas');
    expect(result.html).not.toContain('<script');
    expect(result.scripts).toEqual([{type:'classic',src:'https://cdn.example/bundle.js'},{type:'classic',source:'window.started=true'}]);
  });
  it('keeps isolated CSS and DOM as data',()=>{
    const result=compile('<Iframe><style>{`canvas {position:fixed}`}</style><p>Hello &amp; goodbye</p></Iframe>');
    expect(result.html).toContain('position:fixed');
    expect(result.html).toContain('Hello &amp; goodbye');
  });
  it('refuses author-controlled nested frames',()=>{
    expect(()=>compile('<Iframe><iframe src="https://example.com"/></Iframe>')).toThrow(/frame/i);
  });
  it('refuses conflicting external and inline scripts',()=>{
    expect(()=>compile('<Iframe><script src="https://cdn.example/bundle.js">{`void 0`}</script></Iframe>')).toThrow(/inline.*external|external.*inline/i);
  });
  it.each([
    ['<Iframe sandbox="allow-same-origin"/>', /platform|owned/],
    ['<Iframe compiled={{html:"evil"}}/>', /platform|owned/],
    ['<Iframe><Iframe/></Iframe>', /frame/],
    ['<Iframe><form/></Iframe>', /form/],
    ['<Iframe><meta http-equiv="refresh" content="0;url=https://evil.example"/></Iframe>', /meta/],
    ['<Iframe><button onclick="steal()"/></Iframe>', /attribute/],
    ['<Iframe><div>{doSomething()}</div></Iframe>', /static/],
    ['<Iframe><script src="//evil.example/a.js"/></Iframe>', /URL/],
    ['<Iframe><script src="javascript:alert(1)"/></Iframe>', /URL/],
    ['<Iframe><script type="importmap">{`{}`}</script></Iframe>', /type/],
    ['<Iframe><script>{`const = broken`}</script></Iframe>', /script/],
    ['<Iframe><style>{`</style><img src=x>`}</style></Iframe>', /style/],
  ])('rejects invalid managed grammar %s', (source, error) => expect(()=>compile(source)).toThrow(error));
  it('bounds content and escapes text/attributes without changing node IDs',()=>{
    expect(()=>compile(`<Iframe><p>${'x'.repeat(262145)}</p></Iframe>`)).toThrow(/size|limit|262144/);
    const result=compile('<Iframe><p id="12" title="&quot;&lt;">{`<script>bad</script>`}</p><script type="module">{`export const x=1`}</script></Iframe>');
    expect(result.html).toContain('id="12" title="&quot;&lt;"');
    expect(result.html).toContain('&lt;script&gt;bad&lt;/script&gt;');
    expect(result.scripts).toEqual([{type:'module',source:'export const x=1'}]);
  });
});
