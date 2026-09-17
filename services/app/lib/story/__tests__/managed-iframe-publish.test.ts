import { serializeJsx, validateJsx } from '@/lib/jsx';
import {renderDoc} from '@/lib/skills';
import { publishJsx } from '../jsx-tier';
import {splitHelmet} from '../helmet';
import type {StoredContent} from '../input';
import { parseJsxOrThrow } from '@/test/helpers/jsx';
const inner='<Iframe id="10" title="Canvas" height={320}><style id="11">{`canvas {position:fixed;height:100vh}`}</style><canvas id="12"/><script id="13" src="https://cdn.example/bundle.js"/><script id="14">{`document.querySelector("canvas")`}</script></Iframe>';
describe('managed Iframe publish boundary',()=>{
  it('rejects malformed inline JavaScript at the actual publish door',async()=>{
    const saved=await publishJsx({},'<Iframe><script>{`const = broken`}</script></Iframe>');
    expect(saved).toBeInstanceOf(Response);
    expect((saved as Response).status).toBe(400);
    expect(await (saved as Response).text()).toContain('invalid script');
  });
  it('keeps the normal parent style policy on the Iframe shell, not inner HTML',async()=>{
    const saved=await publishJsx({},'<Iframe id="1" title="Canvas" aria-label="Canvas" className="w-full" style="color:red"><p style="color:red">Inner</p></Iframe>');
    expect(saved).toBeInstanceOf(Response);
    expect(await (saved as Response).text()).toContain('Inline style attribute');
    expect(await publishJsx({},'<Iframe id="1" title="Canvas" aria-label="Canvas" className="w-full"><p style="color:red">Inner</p></Iframe>')).not.toBeInstanceOf(Response);
  });
  it('publishes and round trips isolated source without parent CSS transformation',async()=>{
    const source='<Helmet><style>{`p {height:100vh}`}</style></Helmet>'+inner;
    const saved=await publishJsx({},source);
    expect(saved).not.toBeInstanceOf(Response);
    const stored=saved as StoredContent;
    expect(stored.source).toContain('position:fixed;height:100vh');
    expect(stored.source).toContain('var(--mx-vh,760px)');
    expect(stored.source).toContain('id="12"');
    expect((await publishJsx({},stored.source! ) as StoredContent).source).toBe(stored.source);
  });
  it('does not hoist nested Helmet from isolated contents even on invalid stored markup',()=>{
    const parsed=parseJsxOrThrow('<Iframe><Helmet><title>Not parent</title></Helmet></Iframe>');
    const split=splitHelmet(parsed.nodes);
    expect(split.content.title).toBeNull();
    expect(serializeJsx(split.body)).toContain('<Helmet>');
    expect(validateJsx(split.body,{components:['Iframe']})).toEqual(expect.arrayContaining([expect.objectContaining({message:expect.stringMatching(/Helmet/)})]));
  });
  it.each(['<script>{`void 0`}</script>','<iframe/>','<Iframe api="unsafe"/>','<Iframe><div>{$flag && <p>Hi</p>}</div></Iframe>'])('rejects unsafe source %s',async(source)=>{
    const saved=await publishJsx({},source);
    expect(saved).toBeInstanceOf(Response);
    expect((saved as Response).status).toBe(400);
  });
  it('publishes the documented managed counter/canvas example unchanged on a second save',async()=>{
    const doc=renderDoc('artifactbin/references/markup-iframe.md','https://example.test');
    const sample=/```jsx\n([\s\S]*?)\n```/.exec(doc)?.[1];
    expect(sample).toBeTruthy();
    const saved=await publishJsx({},sample!);
    expect(saved).not.toBeInstanceOf(Response);
    expect((await publishJsx({},(saved as StoredContent).source!) as StoredContent).source).toBe((saved as StoredContent).source);
  });
});
