import {describe,it,expect,vi} from 'vitest';
import {JSDOM} from 'jsdom';
import {readFileSync,readdirSync} from 'node:fs';
import {instrumentClosedRoots,wrapBrowser} from '../lib/gate-browser.mjs';

describe('test-only closed-root browser instrumentation',()=>{
 it('exposes roots through the host getter without changing their native closed mode or event boundary',()=>{
  const dom=new JSDOM('<body></body>',{runScripts:'outside-only',url:'https://gate.test/'});
  dom.window.eval(`(${instrumentClosedRoots.toString()})()`);
  const host=dom.window.document.createElement('div');dom.window.document.body.append(host);
  const root=host.attachShadow({mode:'closed'});
  expect(root.mode).toBe('closed');expect(host.shadowRoot).toBe(root);
  expect(Object.getOwnPropertyDescriptor(host,'shadowRoot').get).toBeTypeOf('function');
  const child=dom.window.document.createElement('button');root.append(child);
  let path;host.addEventListener('click',event=>{path=event.composedPath();});
  child.click();expect(path.some(node=>node===child)).toBe(false);expect(path.some(node=>node===host)).toBe(true);
  const other=dom.window.document.createElement('div');expect(other.shadowRoot).toBeNull();
  dom.window.close();
 });
 it('installs before context pages or standalone pages can navigate, and binds native methods',async()=>{
  const order=[];
  const context={addInitScript:vi.fn(async fn=>{expect(fn).toBe(instrumentClosedRoots);order.push('instrument');})};
  const page={addInitScript:context.addInitScript};
  const native={async newContext(){expect(this).toBe(native);order.push('context');return context;},async newPage(){expect(this).toBe(native);order.push('page');return page;},isConnected(){return this===native;}};
  const browser=wrapBrowser(native);
  expect((await browser.newContext()).addInitScript).toBeTypeOf('function');expect(order).toEqual(['context','instrument']);
  order.length=0;expect((await browser.newPage()).addInitScript).toBeTypeOf('function');expect(order).toEqual(['page','instrument']);
  expect(browser.isConnected()).toBe(true);
 });
});

it('routes every browser gate through explicit instrumentation and never selects an outer artifact frame',()=>{
 const scripts=new URL('../',import.meta.url);
 for(const name of readdirSync(scripts).filter(name=>/^gate-.*\.mjs$/.test(name))){
  const source=readFileSync(new URL(name,scripts),'utf8');
  expect(source,name).not.toMatch(/from ['"]playwright['"]/);
  expect(source,name).not.toMatch(/frameLocator\(['"]iframe\[title=["'](?:artifact|Artifact controls|Artifactbin app|Page controls|Home workspace)/);
 }
 const production=readFileSync(new URL('../../services/app/components/TrustedUi.tsx',import.meta.url),'utf8');
 expect(production).toContain("attachShadow({mode:'closed'})");
 expect(production).not.toContain('instrumentClosedRoots');
});
