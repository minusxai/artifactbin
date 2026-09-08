/** Read-only harness probe; no server creation or authenticated writes. */
import assert from 'node:assert/strict';
import {chromium as nativeChromium} from 'playwright';
import {instrumentClosedRoots,wrapGatePage} from './lib/gate-browser.mjs';
const browser=await nativeChromium.launch();
try{
 const context=await browser.newContext();await context.addInitScript(instrumentClosedRoots);
 const native=await context.newPage();await native.goto(process.argv[2]??'http://localhost:5802/');
 const page=wrapGatePage(native), menu=page.getByRole('button',{name:'Open menu',exact:true});
 await menu.waitFor({timeout:15000});
 assert.equal(await native.locator('[data-trusted-ui-root]').count(),0,'negative control: isolated utility world cannot see main-world getter');
 assert.equal(await page.locator('[data-trusted-ui-root]').count(),1);
 assert.equal(await page.locator('html').count(),1);
 assert.equal(await page.locator('body').count(),1);
 assert.equal(await page.locator('body').getByRole('button',{name:'Open menu',exact:true}).count(),1);
 assert.equal(await page.getByRole('button',{name:'Open menu',exact:true}).locator('svg').count(),1);
 assert.equal(await menu.evaluate(el=>el.getRootNode().mode),'closed');
 assert.equal(await page.mainFrame().getByRole('button',{name:'Open menu',exact:true}).count(),1);
 await menu.click();assert(await page.getByLabel('Login',{exact:true}).isVisible());
 await page.keyboard.press('Escape');await menu.waitFor({state:'visible',timeout:5000});
 await page.evaluate(()=>{const frame=document.createElement('iframe');frame.id='gate-nested-probe';frame.srcdoc='<button>Nested probe</button>';document.body.append(frame);});
 await page.frameLocator('#gate-nested-probe').getByRole('button',{name:'Nested probe'}).waitFor({timeout:5000});
 await page.locator('#gate-nested-probe').evaluate(el=>el.remove());
 console.log('PASS: utility-world negative control; native CSS/role/label in main world; frame wrapper; mode closed; menu click and Escape');
}finally{await browser.close();}
