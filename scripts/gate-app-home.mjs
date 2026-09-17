/** The app redirects logged-out home visits to login, even without JavaScript. */
import assert from 'node:assert/strict';
import {chromium} from 'playwright';
const base=process.argv[2]??'http://localhost:12001';
const browser=await chromium.launch();
try{
 for(const javaScriptEnabled of [false,true]){
  const context=await browser.newContext({javaScriptEnabled});const page=await context.newPage();
  await page.goto(base);assert.equal(new URL(page.url()).pathname,'/login');
  if(javaScriptEnabled)await page.getByRole('textbox',{name:'Email',exact:true}).waitFor();
  assert.equal(await page.locator('canvas').count(),0);
  await context.close();
 }
 console.log('PASS application home redirects to login with and without JavaScript');
}finally{await browser.close();}
