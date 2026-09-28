const page=await context.newPage(); await page.goto('/a/sales01');
const widget=page.frameLocator('iframe[title="Agent widget"]').frameLocator('iframe');
await widget.locator('#region').waitFor();
const desc=await widget.locator('body').evaluate(()=>mx.describe());
return {desc};
