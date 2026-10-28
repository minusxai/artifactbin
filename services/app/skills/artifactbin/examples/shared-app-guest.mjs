/**
 * Example: check.mjs guest steps for examples/shared-app.html: a signed-out reader is refused.
 * Usage: cp examples/shared-app-guest.mjs guest.mjs; set CATEGORY, then pass it as --guest-steps.
 * Gotchas: it runs after the self steps finish, on the wide viewport only; the refusal shows in
 *   #status as a sign-in message.
 */
if(page.viewportSize().width<800)return {assertions:['guest checks run on the wide viewport']};
const CATEGORY='Rent',open=`[data-af-id="cat-${CATEGORY}-open"]`;
await page.locator(open).waitFor({timeout:5000});await page.locator(open).click();
await page.locator('#amount').fill('1');
await page.getByRole('button',{name:/save target/i}).click();
await page.waitForFunction(()=>/sign in/i.test(document.querySelector('#status').textContent),null,
  {timeout:4000});
return {assertions:['a guest cannot change a shared target']};
