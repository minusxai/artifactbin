import {parseJsx,serializeJsx,validateJsx} from '@/lib/jsx';
import {publishJsx} from '../jsx-tier';
import {splitHelmet} from '../helmet';
import type {StoredContent} from '../input';
const inner='<Iframe id="10" title="Canvas" height={320}><style id="11">{`canvas {position:fixed;height:100vh}`}</style><canvas id="12"/><script id="13" src="https://cdn.example/bundle.js"/><script id="14">{`document.querySelector("canvas")`}</script></Iframe>';
describe('managed Iframe publish boundary',()=>{
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
    const parsed=parseJsx('<Iframe><Helmet><title>Not parent</title></Helmet></Iframe>');
    if(!parsed.ok)throw Error(parsed.error);
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
});
