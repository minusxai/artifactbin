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
    expect(()=>compile('<Iframe><script src="https://cdn.example/bundle.js">{`void 0`}</script></Iframe>')).toThrow();
  });
});
