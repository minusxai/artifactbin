// Explicit local integration acceptance. Never requests OTPs or publishes artifacts.
// Inputs contain disposable paths/URLs; keep manifests and receipts outside git.
import assert from 'node:assert/strict';
import {readFile,writeFile,stat} from 'node:fs/promises';
import {pathToFileURL} from 'node:url';
import {resolve} from 'node:path';
if(!process.argv.includes('--execute')){
 console.log('Usage: node scripts/fixtures/local-workflow-browser.mjs --execute PRIVATE_MANIFEST.json');
 console.log('Manifest: {candidate,origin,playwrightModule,linkedFile,privateFile,accountStorageState,output}. Uses existing disposable files and normal browser storage only; no login or publication.');
 process.exit(0);
}
const manifestPath=process.argv[process.argv.indexOf('--execute')+1];assert.ok(manifestPath);
const input=JSON.parse(await readFile(manifestPath,'utf8'));
for(const key of ['candidate','origin','playwrightModule','linkedFile','privateFile','accountStorageState','output'])assert.ok(input[key],key+' required');
assert.match(input.candidate,/^[a-f0-9]{40}$/);
const origin=new URL(input.origin).origin;
assert.ok(['localhost','127.0.0.1','[::1]'].includes(new URL(origin).hostname),'Only an isolated loopback candidate is allowed');
assert.equal((await stat(input.accountStorageState)).mode&0o077,0,'Normal account browser storage must be private');
const {chromium}=await import(pathToFileURL(resolve(input.playwrightModule)).href);
const checks=[],errors=[],contexts=[];let complete=false;
await writeFile(input.output,JSON.stringify({candidate:input.candidate,complete,checks}),{flag:'wx',mode:0o600});
const browser=await chromium.launch({headless:true});
const context=async(options={})=>{const c=await browser.newContext(options);contexts.push(c);return c};
const open=async(c,file)=>{const page=await c.newPage();page.on('pageerror',e=>errors.push(e.message));await page.goto(pathToFileURL(resolve(file)).href);return page};
const broker=page=>page.frameLocator('iframe[data-af-local-broker]');
const visible=async(locator)=>{await locator.waitFor({state:'visible',timeout:30000})};
const absent=async(locator)=>assert.equal(await locator.count(),0);
const check=name=>{checks.push(name);console.log('PASS '+name)};
try{
 const guest=await context();const page=await open(guest,input.linkedFile);const fileURL=page.url();
 await visible(broker(page).getByRole('button',{name:'Open artifact controls',exact:true}));
 assert.equal(page.url(),fileURL);assert.equal(new URL(await page.locator('iframe[data-af-local-broker]').getAttribute('src'),origin).origin,origin);
 await broker(page).getByRole('button',{name:'Open artifact controls',exact:true}).click();
 await visible(broker(page).getByText('Connected to the saved remote.',{exact:true}));
 await absent(broker(page).getByRole('button',{name:'Connect this file',exact:true}));
 check('Linked file opens its own platform guest broker without editing or navigating the file URL');
 const before=await readFile(input.linkedFile);
 await broker(page).getByRole('button',{name:'Save linked HTML',exact:true}).click();
 const downloadPromise=page.waitForEvent('download');
 await broker(page).getByLabel('Choose current HTML file',{exact:true}).setInputFiles(input.linkedFile);
 const download=await downloadPromise;assert.ok(download.suggestedFilename().endsWith('.html'));
 const saved=await readFile(await download.path(),'utf8');assert.match(saved,/data-af=["']portable["']/);assert.deepEqual(await readFile(input.linkedFile),before);
 await visible(broker(page).getByText('Download started. Original disk file unchanged.',{exact:true}));
 check('Save produces actual linked HTML download and leaves original disk bytes unchanged');
 const privateGuest=await open(await context(),input.privateFile);
 await visible(broker(privateGuest).getByRole('button',{name:'Sign in',exact:true}));
 check('Private file with no session offers explicit normal sign-in');
 const account=await context({storageState:input.accountStorageState});const privateAccount=await open(account,input.privateFile);
 await visible(broker(privateAccount).getByRole('button',{name:'Connect this file',exact:true}));
 await absent(broker(privateAccount).getByText('Connected to the saved remote.',{exact:true}));
 await broker(privateAccount).getByRole('button',{name:'Connect this file',exact:true}).click();
 await visible(broker(privateAccount).getByText('Connected to the saved remote.',{exact:true}));
 check('Ambient account session does not auto-authorize private file; explicit approval connects');
 assert.deepEqual(errors,[]);complete=true;
}finally{
 await browser.close();
 await writeFile(input.output,JSON.stringify({candidate:input.candidate,complete,scope:'portable-connection-and-save-only',checks,errors,finished_at:new Date().toISOString()},null,2),{mode:0o600});
}
