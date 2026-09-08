/** TEST ONLY. Imported by browser gates, never application/runtime bundles.
 * Playwright traverses host.shadowRoot. Expose that getter for automation while
 * retaining native mode=closed, event retargeting and the real production CSS.
 * Install before navigation; no production open roots or application globals.
 */
import {chromium as nativeChromium,firefox as nativeFirefox,webkit as nativeWebkit} from 'playwright';
import assert from 'node:assert/strict';

export function instrumentClosedRoots() {
  const attach=Element.prototype.attachShadow;
  Element.prototype.attachShadow=function(init){
    const root=attach.call(this,init);
    if(root.mode==='closed')Object.defineProperty(this,'shadowRoot',{get:()=>root,configurable:true});
    return root;
  };
}

/** A local wrapper, not a monkeypatch of Playwright or production prototypes. */
export function wrapBrowser(browser) {
  return new Proxy(browser,{get(target,key){
    if(key==='newContext'||key==='newPage')return async(...args)=>{
      const created=await target[key](...args);
      await created.addInitScript(instrumentClosedRoots);
      return created;
    };
    const value=Reflect.get(target,key,target);
    return typeof value==='function'?value.bind(target):value;
  }});
}
const engine=type=>new Proxy(type,{get(target,key){
  if(key==='launch')return async(...args)=>wrapBrowser(await target.launch(...args));
  const value=Reflect.get(target,key,target);return typeof value==='function'?value.bind(target):value;
}});
export const chromium=engine(nativeChromium),firefox=engine(nativeFirefox),webkit=engine(nativeWebkit);

export const STORY_HOST='[data-artifact-story-host]';
/** Real authored prose belongs to the main document; nested author sandboxes do not. */
export async function storyFrame(page,options={}) {
  await page.locator(STORY_HOST).waitFor({state:'attached',...options});
  return page.mainFrame();
}

/** Browser assertion, not instrumentation: actual native closed root plus CSS
 * boundary against author-controlled light-DOM selectors and inherited tokens. */
export async function assertTrustedChrome(page) {
  const bar=page.getByLabel('Page bar',{exact:true});await bar.waitFor();
  assert.equal(await bar.evaluate(el=>el.getRootNode().mode),'closed');
  assert.equal(await page.locator('[data-trusted-ui-root]').count(),1,'one persistent trusted root');
  const before=await bar.evaluate(el=>{const c=getComputedStyle(el);return [c.color,c.backgroundColor,c.fontFamily,c.fontSize,c.display];});
  await page.evaluate(()=>{
    const style=document.createElement('style');style.dataset.gateAuthorPoison='';
    style.textContent=':root{--color-fg:lime;--color-surface:red;--font-mono:fantasy} header,button,[data-trusted-ui-root]{color:lime!important;background:red!important;font:99px fantasy!important;display:none!important}';
    document.head.append(style);
  });
  try{assert.deepEqual(await bar.evaluate(el=>{const c=getComputedStyle(el);return [c.color,c.backgroundColor,c.fontFamily,c.fontSize,c.display];}),before,'author CSS cannot style trusted chrome');}
  finally{await page.locator('style[data-gate-author-poison]').evaluate(el=>el.remove());}
  assert.equal(await bar.evaluate(el=>el.getRootNode().querySelectorAll('slot,[part]').length),0,'no sensitive exported slots or parts');
}
