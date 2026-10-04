// node tiles.mjs <id> [<id>...]  → shots/<id>-{light,dark}-N.jpg via clipped captures (avoids the 16384px full-page limit) + mobile tiles
import { chromium } from "playwright";
const ids = process.argv.slice(2);
import path from "node:path";
const out = path.resolve(import.meta.dirname, "../tmp/design-systems/shots");
const b = await chromium.launch();
for (const id of ids) {
  for (const [tag, w, h, dark, tile] of [["light",1440,900,false,1900],["dark",1440,900,true,1900],["mobile",390,844,false,1700]]) {
    const p = await b.newPage({ viewport: { width: w, height: h }, deviceScaleFactor: 1 });
    await p.goto(`https://app.artifactbin.dev/a/${id}`, { waitUntil: "networkidle", timeout: 60000 }).catch(e=>console.error('goto', e.message));
    await p.waitForTimeout(1500);
    await p.evaluate((dark) => { const r=document.querySelector('#mx-story-root'); if (r) { r.classList.remove('light','dark'); r.classList.add(dark ? 'dark' : 'light'); } }, dark); await p.waitForTimeout(800);
    await p.evaluate(async () => { const H=document.documentElement.scrollHeight; for (let y=0;y<H;y+=700){ window.scrollTo(0,y); await new Promise(r=>setTimeout(r,120)); } window.scrollTo(0,0); });
    await p.waitForTimeout(1200);
    const H = await p.evaluate(() => document.documentElement.scrollHeight);
    let n = 0;
    for (let y = 0; y < H; y += tile) {
      const hh = Math.min(tile, H - y);
      await p.screenshot({ path: `${out}/${id}-${tag}-${n}.jpg`, type: 'jpeg', quality: 78, clip: { x: 0, y, width: w, height: hh }, fullPage: true, scale: 'css' });
      n++;
    }
    console.log('wrote', id, tag, n, 'tiles, height', H);
    await p.close();
  }
}
await b.close();
