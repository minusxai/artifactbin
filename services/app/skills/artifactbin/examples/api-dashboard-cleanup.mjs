/**
 * Example: check.mjs cleanup steps for examples/api-dashboard.html: removes every TEST note
 *   (changed ones too: their text starts with TEST).
 * Usage: node scripts/new-app.mjs --kind api copies it as cleanup.mjs (no edits needed); pass it
 *   as --cleanup-steps: it runs signed in, even after a failure.
 * Gotchas: it removes through the page as the owner, who may remove every note.
 */
const TEST='Check note (test)';
await page.waitForFunction(()=>document.querySelector('#board')?.getAttribute('aria-busy')===
  'false',null,{timeout:8000});
await step(`every "${TEST}" note is removed`,async()=>{
  const label='Remove note: '+TEST,buttons=page.locator(`button[aria-label^="${label}"]`);
  for(let left=await buttons.count();left>0;left--){
    await buttons.first().click();
    await page.waitForFunction(([label,n])=>document.querySelectorAll(
      `button[aria-label^="${label}"]`).length<n,[label,left],{timeout:5000});}
  if(await page.getByText(TEST).count())throw Error('a test note is still listed');});
return {steps:'cleanup'};
