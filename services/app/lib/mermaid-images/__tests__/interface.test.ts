import {expect,it} from 'vitest';
import {parseJsx,type JsxNode} from '@/lib/jsx';
import {
 CAPTURE_COLOR_PARAM,MERMAID_ENGINE_PARAM,MERMAID_IMAGE_FILE,MERMAID_MODES,MERMAID_RENDER_ENGINE,MERMAID_SURFACES,MermaidSubsetterUnavailable,
 captureColor,comparableSvg,cssTree,mermaidCodesOf,mermaidContentKey,mermaidObjectKey,
} from '..';
const nodes=(source:string):JsxNode[]=>{const parsed=parseJsx(source);if(!parsed.ok)throw Error('fixture does not parse');return parsed.nodes;};
it('lists each static, drawable Mermaid code once, in document order, at any depth',()=>{
 const doc=nodes(`<Mermaid code="graph TD; A-->B" /><Card><Mermaid code={"sequenceDiagram\\nA->>B: hi"} /></Card><Mermaid code="graph TD; A-->B" /><Mermaid code={source} /><Mermaid code="   " /><Mermaid code={"---\\ntitle: x\\n---\\ngraph TD; A-->B"} /><mermaid code="graph LR; X-->Y" /><Mermaid />`);
 expect(mermaidCodesOf(doc)).toEqual(['graph TD; A-->B','sequenceDiagram\nA->>B: hi']);
 expect(mermaidCodesOf([])).toEqual([]);
});
it('keys a stored drawing by engine, mode, palette, code and its own bytes, not its page position',()=>{
 const svg='<svg id="mx-mermaid-3"><style>#mx-mermaid-3 .node{}</style></svg>';
 const key=mermaidContentKey('light','p1','graph TD; A-->B',svg);
 expect(key).toMatch(/^[0-9a-f]{64}$/);
 expect(mermaidContentKey('light','p1','graph TD; A-->B',svg.replaceAll('mx-mermaid-3','mx-mermaid-12'))).toBe(key);
 for(const other of [mermaidContentKey('dark','p1','graph TD; A-->B',svg),mermaidContentKey('light','p2','graph TD; A-->B',svg),mermaidContentKey('light','p1','graph TD; A-->C',svg),mermaidContentKey('light','p1','graph TD; A-->B',svg+' ')])expect(other).not.toBe(key);
 expect(comparableSvg('a mx-mermaid-1 b mx-mermaid-22')).toBe('a mx-mermaid-N b mx-mermaid-N');
 expect(MERMAID_RENDER_ENGINE).toMatch(/\+kit\d+$/);
});
it('addresses stored drawings and reads only a light or dark capture colour',()=>{
 const key='a'.repeat(64);
 expect(mermaidObjectKey(key)).toBe(`mermaid/${key}.svg`);
 expect(MERMAID_IMAGE_FILE.exec(`${key}.svg`)?.[1]).toBe(key);
 for(const file of [`${key}.png`,`${'A'.repeat(64)}.svg`,`../${key}.svg`,`${key}.svg.svg`])expect(MERMAID_IMAGE_FILE.test(file)).toBe(false);
 expect(captureColor(`https://x.test/a?${CAPTURE_COLOR_PARAM}=dark`)).toBe('dark');
 expect(captureColor(new URL('https://x.test/a?color=light'))).toBe('light');
 for(const url of ['https://x.test/a','https://x.test/a?color=blue','https://x.test/a?color=DARK'])expect(captureColor(url)).toBeNull();
 expect([MERMAID_ENGINE_PARAM,MERMAID_MODES,MERMAID_SURFACES]).toEqual(['mermaid',['light','dark'],['document','inline']]);
});
it('names an unavailable subsetter as its own error type',()=>{
 const error=new MermaidSubsetterUnavailable('wasm missing');
 expect(error).toBeInstanceOf(Error);expect(error).toBeInstanceOf(MermaidSubsetterUnavailable);expect(error.message).toBe('wasm missing');
});
it('parses and regenerates CSS through the browser-safe css-tree subset',()=>{
 const ast=cssTree.parse('.a{color:red}');
 const seen:string[]=[];cssTree.walk(ast,{visit:'ClassSelector',enter:node=>{seen.push(node.name);}});
 expect(seen).toEqual(['a']);expect(cssTree.generate(ast)).toBe('.a{color:red}');
 expect(cssTree.string.encode('x"y')).toBe('"x\\"y"');expect(cssTree.url.encode('a b')).toBe('url(a\\ b)');expect(cssTree.ident.encode('1a')).toBe('\\31 a');
});
