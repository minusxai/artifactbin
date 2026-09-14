const page=await context.newPage(); await page.goto('/a/sales01');
await page.waitForFunction(()=>window.mx);
const desc=await page.evaluate(()=>mx.describe());
return {desc};
