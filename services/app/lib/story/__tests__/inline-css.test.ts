import { describe, expect, it } from 'vitest';
import { isolateStoryCss, isolateStoryNodes } from '../inline-css';
import { parseJsx } from '@/lib/jsx';

describe('inline document CSS isolation', () => {
  it('preserves custom chart font names but aliases trusted UI families in SVG attributes', () => {
    const css = '@font-face{font-family:"My Font";src:url(/webfonts/a.woff2)}@font-face{font-family:"IBM Plex Sans";src:url(/webfonts/b.woff2)}';
    expect(isolateStoryCss(css)).toContain('font-family:"My Font"');
    const parsed = parseJsx('<svg><text fontFamily="IBM Plex Sans">Label</text></svg>');
    if (!parsed.ok) throw Error(parsed.error);
    expect(JSON.stringify(isolateStoryNodes(parsed.nodes, css))).toContain('mx-author-');
  });
  it('keeps cached imported webfonts', () => {
    expect(isolateStoryCss('@font-face{font-family:F;src:url(/webfonts/font.woff2)}')).toContain('/webfonts/font.woff2');
  });
  it('maps inline font references and unsafe image-set values without changing numeric styles or iframe payloads', () => {
    const parsed = parseJsx('<p id="kept" style={{fontFamily:"IBM Plex Sans",fontSize:14,backgroundImage:\'image-set("https://evil.test/p" 1x)\'}}>Text</p><Iframe><p style={{fontFamily:"My Font"}}>Inner</p></Iframe>');
    if (!parsed.ok) throw Error(parsed.error);
    const nodes = isolateStoryNodes(parsed.nodes, '@font-face{font-family:"IBM Plex Sans";src:url(/webfonts/a.woff2)}');
    const first = nodes[0];
    if (first.type !== 'element') throw Error('Missing p');
    const style = first.attributes.find(attr=>attr.name==='style')?.value;
    expect(style?.static && style.json).toMatchObject({fontSize:14,fontFamily:expect.stringContaining('mx-author-')});
    expect(JSON.stringify(style)).not.toContain('evil.test');
    expect(nodes[1]).toEqual(parsed.nodes[1]);
    expect(JSON.stringify(parsed.nodes[0])).toContain('IBM Plex Sans');
  });
  it('removes global property registrations and namespaces font faces with their references', () => {
    const css = isolateStoryCss('@property --color-fg{syntax:"<color>";inherits:true;initial-value:red}@font-face{font-family:"JetBrains Mono Variable";src:url(/fonts/font.woff2)}body{font-family:"JetBrains Mono Variable",monospace}');
    expect(css).not.toContain('@property');
    expect(css).toContain('mx-author-');
    expect(css).not.toContain('"JetBrains Mono Variable"');
    expect(css).toContain('monospace');
    expect(css).toContain('/fonts/font.woff2');
    expect(isolateStoryCss(css)).toBe(css);
  });
  it('normalizes root selectors without rewriting string content', () => {
    const css = isolateStoryCss(':root.dark,html.dark,body{color:red}p::after{content:"body :root"}');
    expect(css).toContain('[data-mx-inline-story].dark');
    expect(css).toContain('content:"body :root"');
  });
  it('blocks url, escaped url, src and image-set string network targets while preserving cached assets', () => {
    const css = isolateStoryCss('.a{background:image-set("https://evil.test/leak" 1x,url(/assets/0123456789abcdef) 2x);cursor:u\\72l(//evil.test/c),auto;--image:src("https://evil.test/s");mask:url(data:image/png;base64,AAAA)}');
    expect(css).not.toContain('evil.test');
    expect(css).toContain('/assets/0123456789abcdef');
    expect(css).toContain('data:image/png;base64,AAAA');
  });
  it('rejects imports and unknown global registries but preserves local animations', () => {
    const css = isolateStoryCss('@import "data:text/css,p{color:red}";@counter-style evil{system:cyclic;symbols:url(https://evil.test)}@keyframes fade{from{opacity:0}to{opacity:1}}');
    expect(css).not.toContain('@import');
    expect(css).not.toContain('@counter-style');
    expect(css).toContain('@keyframes fade');
  });
  it('retains Tailwind property initial values as document-scoped declarations, not registrations', () => {
    const css = isolateStoryCss('@property --tw-translate-x{syntax:"*";inherits:false;initial-value:0}@property --tw-shadow{syntax:"*";inherits:false;initial-value:0 0 #0000}.translate{translate:var(--tw-translate-x) var(--tw-translate-y)}');
    expect(css).not.toContain('@property');
    expect(css).toContain('[data-mx-inline-story] *{--tw-translate-x:0}');
    expect(css).toContain('--tw-shadow:0 0#0000');
  });
});
