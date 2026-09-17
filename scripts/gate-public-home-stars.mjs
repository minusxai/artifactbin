/** OSS homepage stays readable without JS and exposes its real login/setup paths. */
import assert from 'node:assert/strict';
import {chromium} from 'playwright';
const base=process.argv[2]??'http://localhost:12001';
const browser=await chromium.launch();
try{
 for(const javaScriptEnabled of [false,true]){
  const context=await browser.newContext({javaScriptEnabled});const page=await context.newPage();
  await page.goto(base);const about=page.getByRole('region',{name:'About Artifactbin'});
  await about.getByRole('heading',{name:'Create, edit and share interactive documents.'}).waitFor();
  assert.equal(await page.locator('canvas').count(),0);
  assert.equal(await about.getByRole('link',{name:'Sign in to your workspace'}).getAttribute('href'),'/login');
  await about.getByRole('link',{name:'Sign in to your workspace'}).click();await page.waitForURL('**/login**');
  await context.close();
 }
 console.log('PASS lightweight OSS landing with and without JavaScript; real login navigation');
}finally{await browser.close();}
