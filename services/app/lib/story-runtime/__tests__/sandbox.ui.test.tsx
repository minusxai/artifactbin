import {afterEach,describe,expect,it,vi} from 'vitest';
import {cleanup,render} from '@testing-library/react';
import {SandboxView,sandboxDocument} from '../sandbox';
import {createDataflowStore} from '../store';
import {StoryRuntimeApp} from '../StoryRuntimeApp';
import {parseJsx} from '@/lib/jsx';

const fixtureApi={resolveUrl:'https://example.test/a/Abc123/resolve',libraries:{three:'https://example.test/libraries/three-0.185.1/index.js'}};
const store=()=>createDataflowStore({flow:{values:[],queries:[]}});
afterEach(()=>{cleanup();vi.unstubAllGlobals();});
describe('visible sandbox contract',()=>{
  it('composes in actual artifact markup without rendering its HTML in the parent',()=>{
    const parsed=parseJsx('<h1 id="outside">Outside</h1><Sandbox id="model" title="Model" html={\'<canvas id="scene" />\'} script="void 0" />');
    expect(parsed.ok).toBe(true);
    if(!parsed.ok) throw new Error('parse failed');
    const {container}=render(<StoryRuntimeApp nodes={parsed.nodes} refData={{}} colorMode="light" sandboxApi={fixtureApi}/>);
    expect(container.querySelector('iframe')?.title).toBe('Model');
    expect(new URL(container.querySelector('iframe')!.src).searchParams.get('artifact')).toBe('Abc123');
    expect(container.querySelector('#outside')?.textContent).toBe('Outside');
    expect(container.querySelector('#scene')).toBeNull();
  });
  it('reserves visible space, keeps code out of the parent, and owns an opaque child',()=>{
    const {container}=render(<SandboxView store={store()} api={fixtureApi} title="Model" height={350} html='<canvas id="scene"></canvas>' script='window.__escaped=true'/>);
    const frame=container.querySelector('iframe')!;
    expect(frame).not.toBeNull();
    expect(frame.title).toBe('Model');
    expect(frame.hidden).toBe(false);
    expect(frame.getAttribute('sandbox')).toBe('allow-scripts');
    expect(frame.style.height).toBe('100%');
    expect(frame.parentElement?.style.height).toBe('350px');
    expect(container.querySelector('canvas')).toBeNull();
    expect(container.querySelector('script')).toBeNull();
    expect((window as unknown as {__escaped?:boolean}).__escaped).toBeUndefined();
  });
  it('keeps the realm across store updates; replaces changed content and revokes on unmount',()=>{
    const shared=store();
    const view=(script:string)=><SandboxView store={shared} api={fixtureApi} title="Model" html="<canvas/>" script={script}/>;
    const rendered=render(view('void 1'));
    const first=rendered.container.querySelector('iframe')!;
    rendered.rerender(view('void 1'));
    expect(rendered.container.querySelector('iframe')).toBe(first);
    rendered.rerender(view('void 2'));
    expect(first.isConnected).toBe(false);
    const second=rendered.container.querySelector('iframe')!;
    rendered.unmount();
    expect(second.isConnected).toBe(false);
  });
  it('admits only pinned script URLs and the anonymous document asset resolver',()=>{
    const html=sandboxDocument(fixtureApi);
    expect(html).toContain("default-src 'none'");
    expect(html).toContain("script-src 'unsafe-inline' https://example.test/libraries/three-0.185.1/index.js");
    expect(html).toContain('connect-src https://example.test/a/Abc123/resolve blob: data:');
    expect(html).toContain("form-action 'none'");
    expect(html).toContain("frame-src 'none'");
    expect(html).toContain("worker-src 'none'");
    expect(html).not.toContain("'unsafe-eval'");
    expect(html).toContain("credentials: 'omit'");
  });
  it('fails closed on forged API configuration and renders no realm for malformed author props',()=>{
    expect(()=>sandboxDocument({...fixtureApi,resolveUrl:'https://evil.test/exfil'})).toThrow();
    expect(()=>sandboxDocument({...fixtureApi,libraries:{three:'https://evil.test/evil.js'}})).toThrow();
    const {container}=render(<SandboxView store={store()} api={fixtureApi} html={{bad:true}} script={[]}/>);
    expect(container.querySelector('iframe')).toBeNull();
  });
});
