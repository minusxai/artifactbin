// node design-systems/shot.mjs <id> [<id>...]  → tmp/design-systems/shots/<id>-{light,dark,mobile}.png (+ half-size jpg)
import { chromium } from "playwright";
const ids = process.argv.slice(2);
const base = process.env.DS_BASE || "https://app.artifactbin.dev";
const b = await chromium.launch();
for (const id of ids) {
  for (const [tag, w, h, dark] of [["light",1440,900,false],["dark",1440,900,true],["mobile",390,844,false]]) {
    const p = await b.newPage({ viewport: { width: w, height: h }, deviceScaleFactor: 1 });
    await p.goto(`${base}/a/${id}`, { waitUntil: "networkidle", timeout: 45000 }).catch(e=>console.error('goto', e.message));
    await p.waitForTimeout(1500);
    await p.evaluate((dark) => { const r=document.querySelector('#mx-story-root'); if (r) { r.classList.remove('light','dark'); r.classList.add(dark ? 'dark' : 'light'); } }, dark); await p.waitForTimeout(800);
    // scroll through to trigger lazy embeds, then back to top
    await p.evaluate(async () => { const H=document.documentElement.scrollHeight; for (let y=0;y<H;y+=700){ window.scrollTo(0,y); await new Promise(r=>setTimeout(r,120)); } window.scrollTo(0,0); });
    await p.waitForTimeout(1200);
    const out = `tmp/design-systems/shots/${id}-${tag}.png`;
    await p.screenshot({ path: out, fullPage: true });
    console.log('wrote', out);
    await p.close();
  }
}
await b.close();
