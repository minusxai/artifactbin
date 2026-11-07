/**
 * Example: check.mjs cleanup steps for examples/tracker.html: removes every TEST entry.
 * Usage: node scripts/new-app.mjs --kind tracker copies it as cleanup.mjs (no edits needed); pass
 *   it as --cleanup-steps: it runs signed in, always, even after a failure.
 * Gotchas: it removes through the page as the owner, who may remove every entry.
 */
const TEST='Check entry (test)';
await page.waitForFunction(()=>document.querySelector('#lists')?.getAttribute('aria-busy')===
  'false',null,{timeout:6000});
await step(`every "${TEST}" entry is removed`,async()=>{
  const buttons=page.getByRole('button',{name:'Remove '+TEST});
  for(let left=await buttons.count();left>0;left--){
    await buttons.first().click();
    await page.waitForFunction(([label,n])=>document.querySelectorAll(
      `button[aria-label="${label}"]`).length<n,['Remove '+TEST,left],{timeout:5000});}
  if(await page.getByText(TEST,{exact:true}).count())throw Error('a test entry is still listed');});
return {steps:'cleanup'};
