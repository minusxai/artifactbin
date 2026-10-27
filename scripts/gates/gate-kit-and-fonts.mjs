import {installGateSkill} from '../lib/installed-gate-skill.mjs';
/** Native HTML, fonts, CSS and script behavior in the real isolated reader. */
import { readdir } from "node:fs/promises";
import { createChecker } from "./lib/assert.mjs";
import { fixtureFetch as fetch } from "./lib/fixture-http.mjs";
import { launchChromium, PAGES_HOST } from "./lib/browser.mjs";
import { documentFrame } from "./lib/page-facts.mjs";
import { connectAgent } from "./lib/cli-connection.mjs";
import { becomeOwner } from "../lib/start-doc.mjs";
import { publishPageSpeedFixtures } from "../fixtures/page-speed/index.mjs";

const B = process.argv[2] ?? "http://localhost:3030";
const check = createChecker("kit-and-fonts");
const leg = async (name, body) => {
  try {
    await body();
  } catch (error) {
    check(
      false,
      `${name}: ${String(error?.stack ?? error)
        .split("\n")
        .slice(0, 3)
        .join(" | ")
        .slice(0, 500)}`,
    );
  }
};
const pool = async (tasks) => {
  const queue = [...tasks];
  await Promise.all(
    Array.from({ length: 4 }, async () => {
      while (queue.length) await queue.shift()();
    }),
  );
};
const mint = await connectAgent(B);
const publish = async (body, options = {}) => {
  const response = await fetch(`${B}/api/artifacts`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${mint.token}`,
      ...(options.idempotencyKey ? {"Idempotency-Key": options.idempotencyKey} : {}),
    },
    body: JSON.stringify({ visibility: "unlisted", ...body }),
  });
  if (!response.ok) throw Error(`${response.status} ${await response.text()}`);
  return response.json();
};
const css = `*{box-sizing:border-box}body{margin:0;padding:24px;max-width:1000px;margin-inline:auto}button,input,select{font:inherit;padding:8px}article,section,details{padding:16px;margin-block:12px;border:1px solid currentColor}table{width:100%;border-collapse:collapse}td,th{padding:8px;border-bottom:1px solid}svg{max-width:100%}.stats{display:grid;grid-template-columns:repeat(auto-fit,minmax(min(220px,100%),1fr));gap:12px}.stats article{min-width:0}.bar{display:flex;width:100%}.bar>span{padding:8px;white-space:nowrap;font-size:clamp(11px,2vw,18px)}.bar>span:first-child{background:#222;color:white}.bar>span:last-child{background:#ddd;color:#222}.popover-wrap{display:flex;justify-content:end;position:relative;margin-top:32px}#popover{position:absolute;right:0;top:calc(100% + 4px);z-index:20;background:white;color:black;border:1px solid;padding:8px;max-width:100%}#popover[hidden]{display:none}`;
const html = (title, body, script = "", state = {}, head = "", system = "") =>
  `<!doctype html><html${system ? ` data-af-design-system="${system}" data-af-dark="false"` : ""}><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${title}</title>${head}<script src="/af/core.js" data-af="core"></script><script type="application/json" data-af="state">${JSON.stringify(state)}</script><style>${css}</style></head><body>${body}${script ? `<script type="module">import {client,gql} from '@afbin/apollo';${script}</script>` : ""}</body></html>`;
const files = await readdir(
  new URL("../../services/app/public/fonts/", import.meta.url),
);
const face = (name) => {
  const file = files.find(
    (file) => file.startsWith(name) && file.endsWith(".woff2"),
  );
  if (!file) throw Error(`Missing font ${name}`);
  return "/fonts/" + file;
};
const bodyFace = face("noto-serif-latin-400-normal.");
const displayFace = face("cormorant-garamond-latin-wght-normal.");
const fontHead =
  [bodyFace, displayFace]
    .map(
      (url) =>
        `<link rel="preload" as="font" type="font/woff2" crossorigin href="${url}">`,
    )
    .join("") +
  `<style>@font-face{font-family:'Gate Body';src:url('${bodyFace}');font-weight:100 900;font-display:block}@font-face{font-family:'Gate Display';src:url('${displayFace}');font-weight:100 900;font-display:block}body{font-family:'Gate Body',serif}h1{font-family:'Gate Display',serif}</style>`;
const text =
  '<h1 data-af-id="heading">Typography holds still</h1><p data-af-id="copy">The body copy a reader starts reading, with <em>emphasis</em> and <strong>strong words</strong>.</p><table><tbody><tr><td>1,234.50</td></tr></tbody></table>';
const [fontDoc, prose, kit, popover, bars, fixtures] = await Promise.all([
  publish({ html: html("Font delivery", text, "", {}, fontHead) }),
  publish({
    html: html("Just words", "<h1>Just words</h1><p>No charts here.</p>"),
  }),
  publish({
    html: html(
      "Native control gallery",
      `<h1 data-af-id="gallery-title">The Kitchen Sink</h1><article><h2>Card title</h2><p role="status">Heads up</p></article><button id="open-dialog">Open dialog</button><dialog aria-label="Kitchen sink dialog"><p>Dialog content opened from the gallery.</p><button id="close-dialog">Close</button></dialog><nav><button id="tab-one">Tab one</button><button id="tab-two">Tab two</button></nav><section id="pane"></section><details><summary>Accordion section B</summary><p>Collapsed until clicked</p></details><dl><dt>Definition term</dt><dd>A definition</dd></dl><button id="increment">Increment</button><output id="count"></output><svg role="img" aria-label="Revenue chart" viewBox="0 0 200 100"><path d="M10 90V20H60V90M80 90V45H130V90" fill="#377da8"/></svg>`,
      `const query=gql\`{count tab}\`;async function draw(){const {data}=await client.query({query});document.querySelector('#count').textContent=data.count;document.querySelector('#pane').textContent=data.tab===1?'First pane content':'Second pane content'}document.querySelector('#increment').onclick=async()=>{await client.updateQuery({query},data=>({...data,count:data.count+1}));await draw()};for(const [id,tab] of [['tab-one',1],['tab-two',2]])document.getElementById(id).onclick=async()=>{await client.updateQuery({query},data=>({...data,tab}));await draw()};document.querySelector('#open-dialog').onclick=()=>document.querySelector('dialog').showModal();document.querySelector('#close-dialog').onclick=()=>document.querySelector('dialog').close();await draw();document.documentElement.dataset.afReady='yes';`,
      { count: 0, tab: 1 },
      fontHead,
    ),
  }),
  publish({
    html: html(
      "Popover placement",
      '<h1>Popover</h1><div class="popover-wrap"><button id="trigger" aria-expanded="false">Open popover</button><div id="popover" hidden>Popover body<button id="option">Owner choice</button></div></div><table style="position:relative;z-index:10"><tr><th>Table heading</th></tr></table>',
      `document.querySelector('#trigger').onclick=event=>{document.querySelector('#popover').hidden=false;event.target.setAttribute('aria-expanded','true')};document.documentElement.dataset.afReady='yes'`,
    ),
  }),
  publish({
    html: html(
      "Responsive metrics",
      "<h1>Responsive metrics</h1>" +
        [2, 3]
          .map(
            (count) =>
              `<div id="row-${count}" class="stats">${Array.from({ length: count }, (_, i) => `<article><span>Metric ${i + 1}</span><strong>120</strong></article>`).join("")}</div>`,
          )
          .join("") +
        '<div id="bar" class="bar"><span style="flex:0 0 71%"><output id="today"></output> TODAY</span><span style="flex:0 0 29%"><output id="target"></output> TARGET</span></div>',
      `const {data}=await client.query({query:gql\`{today target}\`});for(const key of ['today','target'])document.getElementById(key).textContent=data[key].toFixed(1);document.documentElement.dataset.afReady='yes'`,
      { today: 11, target: 4.5 },
    ),
  }),
  publishPageSpeedFixtures(publish),
]);
const archiveResponse = await fetch(`${B}/skills/artifactbin.zip`);
if (!archiveResponse.ok) throw Error(`Installed skill unavailable (${archiveResponse.status})`);
const installed = await installGateSkill(new Uint8Array(await archiveResponse.arrayBuffer()), B);
const systems = [...installed.files.keys()].filter(name => /^design-systems\/[^/]+\.css$/.test(name));
const themeDocs = await Promise.all(systems.map(async file => {
  const name = file.slice('design-systems/'.length, -4);
  const prepared = await installed.prepare(html(
    name,
    '<h1 class="t-title">Typography holds still</h1><p class="t-body">Readable body copy.</p><p class="t-label">Measured today</p>',
    '', {}, `<link data-af="design-system" rel="stylesheet" href="./${name}.css">`, name,
  ), `design-systems/gate-${name}.html`);
  return {name, ...(await publish(prepared.body, {idempotencyKey:prepared.idempotencyKey}))};
})).finally(() => installed.dispose());
const sceneScript = `import * as THREE from 'https://esm.sh/three@0.170.0';try{const canvas=document.querySelector('canvas');const renderer=new THREE.WebGLRenderer({canvas,preserveDrawingBuffer:true});renderer.setSize(400,300,false);const scene=new THREE.Scene();const camera=new THREE.PerspectiveCamera(45,4/3,.1,100);camera.position.z=4;const geometry=new THREE.BufferGeometry();geometry.setAttribute('position',new THREE.BufferAttribute(new Float32Array([-1,-1,0,1,-1,0,0,1,0]),3));scene.add(new THREE.Mesh(geometry,new THREE.MeshBasicMaterial({color:'#ef3340',side:THREE.DoubleSide})));renderer.render(scene,camera);const pixel=new Uint8Array(4);renderer.getContext().readPixels(200,150,1,1,renderer.getContext().RGBA,renderer.getContext().UNSIGNED_BYTE,pixel);canvas.dataset.pixel=JSON.stringify([...pixel]);canvas.dataset.same=String(THREE===await import('https://esm.sh/three@0.170.0'))}catch(error){document.querySelector('canvas').dataset.error=String(error)}`;
const sceneDocs = await Promise.all(
  [false, true].map((card) =>
    publish({
      html: html(
        "WebGL",
        `${card ? "<article><h1>Authored card</h1>" : ""}<canvas width="400" height="300"></canvas>${card ? "</article>" : ""}`,
      ).replace(
        "</body>",
        `<script type="module">${sceneScript}</script></body>`,
      ),
    }),
  ),
);
const browser = await launchChromium();
const glBrowser = await launchChromium({
  args: ["--enable-unsafe-swiftshader"],
});
try {
  const FIRST_SCREEN_PROBE = async () => {
    await document.fonts.ready;
    const span = (range) =>
      (range || "U+0-10FFFF").split(",").map((part) => {
        const t = part.trim().replace(/^u\+/i, "");
        const [lo, hi = lo] = t.includes("?")
          ? [t.replace(/\?/g, "0"), t.replace(/\?/g, "F")]
          : t.split("-");
        return [parseInt(lo, 16), parseInt(hi, 16)];
      });
    const covers = (range, code) =>
      span(range).some(([lo, hi]) => lo <= code && code <= hi);
    const rules = [];
    const collect = (list) => {
      for (const r of list) {
        if (r instanceof CSSFontFaceRule) rules.push(r);
        else if (r.cssRules) collect(r.cssRules);
      }
    };
    for (const sheet of [
      ...document.styleSheets,
      ...(document.adoptedStyleSheets ?? []),
    ]) {
      try {
        collect(sheet.cssRules);
      } catch {
        /* cross-origin sheet */
      }
    }
    const norm = (family) => family.trim().replace(/^["']|["']$/g, "");
    const faces = rules
      .map((r) => {
        const [lo, hi = lo] = (r.style.getPropertyValue("font-weight") || "400")
          .trim()
          .split(/\s+/)
          .map(Number);
        const src = /url\(\s*["']?([^"')]+)/.exec(
          r.style.getPropertyValue("src"),
        )?.[1];
        return {
          family: norm(r.style.getPropertyValue("font-family")),
          style: r.style.getPropertyValue("font-style") || "normal",
          lo,
          hi,
          range: r.style.getPropertyValue("unicode-range"),
          url: src ? new URL(src, location.href).pathname : null,
        };
      })
      .filter((f) => f.url);
    const loaded = new Set();
    for (const ff of document.fonts) {
      if (ff.status !== "loaded") continue;
      const [lo, hi = lo] = String(ff.weight).split(/\s+/).map(Number);
      for (const f of faces)
        if (
          f.family === norm(ff.family) &&
          f.style === ff.style &&
          f.lo === lo &&
          f.hi === hi &&
          span(f.range).join() === span(ff.unicodeRange).join()
        )
          loaded.add(f.url);
    }
    const painted = new Set();
    const walker = document.createTreeWalker(
      document.body,
      NodeFilter.SHOW_TEXT,
    );
    for (let n; (n = walker.nextNode());) {
      const text = n.textContent.trim();
      const el = n.parentElement;
      if (!text || !el) continue;
      const box = el.getBoundingClientRect();
      const cs = getComputedStyle(el);
      if (
        box.width === 0 ||
        box.bottom < 0 ||
        box.top > innerHeight ||
        cs.display === "none" ||
        cs.visibility === "hidden"
      )
        continue;
      const family = cs.fontFamily
        .split(",")
        .map(norm)
        .find((f) => faces.some((x) => x.family === f));
      if (!family) continue;
      const code =
        [...text].find((c) => c.codePointAt(0) > 32)?.codePointAt(0) ?? 65;
      const weight = Number(cs.fontWeight);
      const candidates = faces.filter(
        (f) => f.family === family && covers(f.range, code),
      );
      const italic =
        cs.fontStyle !== "normal" &&
        candidates.some((f) => f.style !== "normal");
      const styled = candidates.filter(
        (f) => (f.style !== "normal") === italic,
      );
      const inRange = styled.filter((f) => f.lo <= weight && weight <= f.hi);
      const pick =
        inRange[0] ??
        styled.sort(
          (a, b) => Math.abs(a.lo - weight) - Math.abs(b.lo - weight),
        )[0];
      if (pick) painted.add(pick.url);
    }
    const fetched = performance
      .getEntriesByType("resource")
      .filter((e) => /\.woff2(\?|$)/.test(e.name))
      .map((e) => new URL(e.name).pathname);
    return {
      preloads: [
        ...document.querySelectorAll("link[rel=preload][as=font]"),
      ].map((l) => ({ url: new URL(l.href).pathname, cors: l.crossOrigin })),
      loaded: [...loaded],
      painted: [...painted],
      fetched,
    };
  };
  const open = async (context, id) => {
    const page = await context.newPage();
    await page.goto(`${B}/a/${id}`, { waitUntil: "load" });
    const frame = await documentFrame(page);
    await frame.waitForSelector("h1");
    return { page, frame };
  };
  // Author-provided local WOFF2 faces keep original delivery and cache checks.
  await leg("font delivery", async () => {
    const raw = await (await fetch(`${B}/a/${fontDoc.id}/raw`)).text();
    const tags = [...raw.matchAll(/<link[^>]+rel="preload"[^>]*>/g)]
      .map((match) => match[0])
      .filter((tag) => tag.includes('as="font"'));
    check(
      tags.length === 2 && tags.every((tag) => tag.includes("crossorigin")),
      "both authored font preloads survive in the document head with crossorigin",
    );
    check(
      raw.indexOf('rel="preload"') < raw.indexOf("@font-face"),
      "font preload precedes its CSS face",
    );
    for (const url of [bodyFace, displayFace]) {
      const response = await fetch(`${B}${url}`);
      const bytes = (await response.arrayBuffer()).byteLength;
      check(
        response.ok && bytes < 300 * 1024,
        `local WOFF2 serves compact bytes (${Math.round(bytes / 1024)}KB)`,
      );
      check(
        /immutable/.test(response.headers.get("cache-control") ?? ""),
        "font response is immutable",
      );
    }
    check(
      (await fetch(`${B}/fonts/NotoSerif-Regular.ttf`)).status === 404,
      "retired unhashed TTF remains absent",
    );
    {
      // D17: the same bytes at the platform's plain-name address, immutable.
      const plain = await fetch(`${B}/af/fonts/${bodyFace.split("/").at(-1).replace(/\.[a-f0-9]{8}\.woff2$/, ".woff2")}`);
      const hashed = await fetch(`${B}${bodyFace}`);
      check(
        plain.status === 200 &&
          /immutable/.test(plain.headers.get("cache-control") ?? "") &&
          Buffer.from(await plain.arrayBuffer()).equals(Buffer.from(await hashed.arrayBuffer())),
        "platform font name serves the hashed file's bytes, immutable",
      );
    }
    const context = await browser.newContext();
    const { page, frame } = await open(context, fontDoc.id);
    const read = async (target) =>
      target.evaluate(async () => {
        await document.fonts.ready;
        return {
          loaded: [...document.fonts]
            .filter((face) => face.status === "loaded")
            .map((face) => face.family),
          body: getComputedStyle(document.body).fontFamily,
          heading: getComputedStyle(document.querySelector("h1")).fontFamily,
          resources: performance
            .getEntriesByType("resource")
            .filter((entry) => entry.name.includes("/fonts/"))
            .map((entry) => ({
              path: new URL(entry.name).pathname,
              transfer: entry.transferSize,
              duration: entry.duration,
              initiator: entry.initiatorType,
              start: entry.startTime,
            })),
          interactive:
            performance.getEntriesByType("navigation")[0]?.domInteractive,
        };
      });
    const cold = await read(frame);
    check(
      cold.loaded.includes("Gate Body") && cold.loaded.includes("Gate Display"),
      "both faces load inside isolated reader",
    );
    check(
      cold.body.includes("Gate Body") && cold.heading.includes("Gate Display"),
      "heading and body use authored families",
    );
    check(
      cold.resources.length === 2 &&
        cold.resources.every((entry) => entry.initiator === "link"),
      "each face fetched once through preload",
    );
    check(
      cold.resources.every((entry) => entry.start <= cold.interactive),
      "font requests start before document interactivity",
    );
    await page.reload({ waitUntil: "load" });
    const warm = await read(await documentFrame(page));
    check(
      warm.resources.length === 2 &&
        warm.resources.every((entry) => entry.transfer === 0),
      "warm fonts spend no transfer bytes",
    );
    await context.close();
  });
  const owner = await browser.newContext({
    viewport: { width: 1400, height: 900 },
  });
  const login = await owner.newPage();
  await becomeOwner(login, B, mint.token);
  await login.close();
  const guest = await browser.newContext({
    viewport: { width: 1400, height: 900 },
  });
  const galleryTask = () =>
    leg("native controls and viewer state", async () => {
      const page = await owner.newPage();
      const requests = [],
        errors = [];
      page.on("request", (request) => requests.push(request.url()));
      page.on("pageerror", (error) => errors.push(String(error)));
      await page.goto(`${B}/a/${kit.id}`);
      const frame = await documentFrame(page);
      await frame.waitForSelector('html[data-af-ready="yes"]');
      const title = await frame.locator("h1").elementHandle();
      for (const text of [
        "The Kitchen Sink",
        "Card title",
        "Heads up",
        "First pane content",
        "Definition term",
      ])
        check(
          (await frame.locator("body").innerText()).includes(text),
          `renders ${text}`,
        );
      await frame
        .getByRole("button", { name: "Open dialog", exact: true })
        .click();
      check(
        await frame.locator("dialog").evaluate((dialog) => dialog.open),
        "native dialog opens",
      );
      await frame.getByRole("button", { name: "Close", exact: true }).click();
      check(
        await frame.locator("dialog").evaluate((dialog) => !dialog.open),
        "native dialog closes",
      );
      await frame.getByRole("button", { name: "Tab two", exact: true }).click();
      await frame.waitForFunction(
        () =>
          document.querySelector("#pane").textContent === "Second pane content",
      );
      check(true, "Apollo local state switches authored panes");
      await frame.locator("summary").click();
      check(
        await frame.locator("details").evaluate((details) => details.open),
        "native disclosure opens",
      );
      await frame
        .getByRole("button", { name: "Increment", exact: true })
        .click();
      await frame.waitForFunction(
        () => document.querySelector("#count").textContent === "1",
      );
      check(
        await title.evaluate(
          (node) => node === document.querySelector("h1") && node.isConnected,
        ),
        "control updates retain original authored heading node",
      );
      await page.reload();
      const reloaded = await documentFrame(page);
      await reloaded.waitForFunction(
        () => document.querySelector("#count")?.textContent === "1",
      );
      check(true, "Apollo viewer state survives reload");
      const other = await open(guest, kit.id);
      await other.frame.waitForFunction(
        () => document.querySelector("#count")?.textContent === "0",
      );
      check(true, "anonymous viewer gets independent local state");
      await other.page.close();
      check(
        (await reloaded
          .locator('svg[aria-label="Revenue chart"] path')
          .count()) === 1,
        "author SVG chart retains its painted geometry",
      );
      const own = (url) => {
        const parsed = new URL(url);
        return (
          parsed.port === new URL(B).port &&
          (parsed.hostname === PAGES_HOST ||
            parsed.hostname.endsWith(`.${PAGES_HOST}`))
        );
      };
      check(
        requests.every((url) => own(url) || /^(data|blob):/.test(url)),
        "native gallery makes no external requests",
      );
      check(
        errors.length === 0,
        `native controls have no page errors (${errors[0] ?? "none"})`,
      );
      await page.close();
    });
  const proseTask = () =>
    leg("prose cost", async () => {
      const page = await guest.newPage(),
        requests = [];
      page.on("request", (request) => requests.push(request.url()));
      await page.goto(`${B}/a/${prose.id}`);
      await (await documentFrame(page)).waitForSelector("h1");
      check(
        !requests.some((url) => /esm\.sh|vega|three@|chart-chunk/.test(url)),
        "prose loads no chart or third-party library",
      );
      check(
        await (
          await documentFrame(page)
        ).evaluate(() => {
          const core = document.querySelector('script[data-af="core"]');
          return !!core && !core.src && core.textContent.length > 0;
        }),
        "native prose receives its assembled inline core",
      );
      await page.close();
    });
  const responsiveTasks = [390, 1440].flatMap((width) => [
    () =>
      leg(`popover ${width}`, async () => {
        const context = await browser.newContext({
          viewport: { width, height: 900 },
        });
        try {
          const { page, frame } = await open(context, popover.id);
          await frame.waitForSelector('html[data-af-ready="yes"]');
          await frame
            .getByRole("button", { name: "Open popover", exact: true })
            .click();
          const box = await frame.evaluate(() => {
            const trigger = document
                .querySelector("#trigger")
                .getBoundingClientRect(),
              content = document
                .querySelector("#popover")
                .getBoundingClientRect(),
              option = document.querySelector("#option"),
              rect = option.getBoundingClientRect();
            return {
              bottom: trigger.bottom,
              top: content.top,
              left: content.left,
              right: content.right,
              width: innerWidth,
              onTop: option.contains(
                document.elementFromPoint(
                  rect.left + rect.width / 2,
                  rect.top + rect.height / 2,
                ),
              ),
            };
          });
          check(
            Math.abs(box.top - box.bottom - 4) <= 2,
            `${width}px popover sits under its trigger`,
          );
          check(
            box.left >= 0 && box.right <= box.width,
            `${width}px popover stays on screen`,
          );
          check(box.onTop, `${width}px option paints above positioned table`);
          await page.close();
        } finally {
          await context.close();
        }
      }),
    () =>
      leg(`metrics ${width}`, async () => {
        const context = await browser.newContext({
          viewport: { width, height: 900 },
        });
        try {
          const { frame } = await open(context, bars.id);
          await frame.waitForSelector('html[data-af-ready="yes"]');
          const result = await frame.evaluate(() => ({
            overflow: document.documentElement.scrollWidth - innerWidth,
            rows: [2, 3].map((count) => {
              const row = document.getElementById(`row-${count}`);
              return {
                overflow: row.scrollWidth - row.clientWidth,
                tops: [...row.children].map(
                  (child) => child.getBoundingClientRect().top,
                ),
              };
            }),
            bar:
              document.querySelector("#bar").scrollWidth -
              document.querySelector("#bar").clientWidth,
            values: ["today", "target"].map(
              (key) => document.getElementById(key).textContent,
            ),
          }));
          check(
            result.overflow <= 1 &&
              result.rows.every((row) => row.overflow <= 1),
            `${width}px stat cards fit reader`,
          );
          if (width === 1440)
            check(
              result.rows.every((row) =>
                row.tops.every((top) => Math.abs(top - row.tops[0]) <= 1),
              ),
              "desktop metrics stay in their rows",
            );
          check(
            result.bar <= 1 && result.values.join(",") === "11.0,4.5",
            `${width}px proportional number bar paints Apollo values without overflow`,
          );
        } finally {
          await context.close();
        }
      }),
  ]);
  // Native core must retain served author nodes; no compiler handover is involved.
  const stableTasks = fixtures.flatMap((fixture) =>
    [owner, guest].map(
      (context, index) => () =>
        leg(
          `served DOM ${fixture.key} ${index ? "guest" : "owner"}`,
          async () => {
            const page = await context.newPage();
            const errors = [];
            page.on("pageerror", (error) => errors.push(String(error)));
            await page.addInitScript(() => {
              document.addEventListener("DOMContentLoaded", () => {
                window.__served = {
                  body: document.body,
                  nodes: [
                    ...document.querySelectorAll("h1,h2,p,td,th,summary"),
                  ].map((node) => ({
                    node,
                    text: node.textContent,
                    attrs: [...node.attributes].map((attr) => [
                      attr.name,
                      attr.value,
                    ]),
                  })),
                };
              });
            });
            await page.goto(`${B}/a/${fixture.id}`, { waitUntil: "load" });
            const frame = await documentFrame(page);
            await frame.waitForSelector("h1");
            // A script-free page has no readiness marker; the load event includes its core.
            const verdict = await frame.evaluate(() => {
              const served = window.__served;
              return {
                captured: !!served,
                same: served?.body === document.body,
                count: served?.nodes.length ?? 0,
                changed:
                  served?.nodes.filter(
                    ({ node, text, attrs }) =>
                      !node.isConnected ||
                      node.textContent !== text ||
                      JSON.stringify(
                        [...node.attributes].map((attr) => [
                          attr.name,
                          attr.value,
                        ]),
                      ) !== JSON.stringify(attrs),
                  ).length ?? -1,
              };
            });
            check(
              verdict.captured &&
                verdict.same &&
                verdict.count > 0 &&
                verdict.changed === 0,
              `${fixture.key} ${index ? "guest" : "owner"} keeps served static nodes/text/attributes (${verdict.count} nodes, ${verdict.changed} changed)`,
            );
            check(
              errors.length === 0,
              `${fixture.key} has no script errors (${errors[0] ?? "none"})`,
            );
            await page.close();
          },
        ),
    ),
  );
  const themeTasks = themeDocs.flatMap((theme) =>
    ["wrapped", "raw"].map(
      (surface) => () =>
        leg(`${theme.name} ${surface}`, async () => {
          const context = await browser.newContext();
          try {
            const page = await context.newPage();
            await page.goto(
              `${B}/a/${theme.id}${surface === "raw" ? "/raw" : ""}`,
              { waitUntil: "load" },
            );
            const frame =
              surface === "raw" ? page.mainFrame() : await documentFrame(page);
            await frame.waitForSelector("h1");
            const result = await frame.evaluate(async () => {
              await document.fonts.ready;
              return {
                system: document.documentElement.dataset.afDesignSystem,
                // The platform stylesheet carries every system; the core sets the attribute from the page's meta.
                css: !!document.querySelector('link[data-af="platform-styles"]')?.sheet,
                family: getComputedStyle(document.querySelector("h1"))
                  .fontFamily,
                faces: [...document.fonts].length,
                readable:
                  document.querySelector("h1").getBoundingClientRect().height >
                  0,
                overflow: document.documentElement.scrollWidth - innerWidth,
              };
            });
            check(
              result.system === theme.name && result.css,
              `${theme.name} ${surface} applies its design system through the platform stylesheet`,
            );
            check(
              result.faces > 0 &&
                result.family.length > 0 &&
                result.readable &&
                result.overflow <= 1,
              `${theme.name} ${surface} declares its fonts and readable fallback (${result.family})`,
            );
          } finally {
            await context.close();
          }
        }),
    ),
  );
  const shellTasks = ["/login", "/docs-human", "/no-such-page"].map(
    (path) => () =>
      leg(`shell ${path}`, async () => {
        const page = await guest.newPage();
        try {
          await page.goto(`${B}${path}`, { waitUntil: "load" });
          const result = await page.evaluate(FIRST_SCREEN_PROBE);
          check(
            result.preloads.length > 0 &&
              result.preloads.every(
                (preload) =>
                  preload.cors === "anonymous" &&
                  result.loaded.includes(preload.url),
              ),
            `shell ${path} preloads and paints its face`,
          );
          check(
            new Set(result.fetched).size === result.fetched.length &&
              result.fetched.every((url) => url.startsWith("/fonts/")),
            `shell ${path} fetches each local font once`,
          );
        } finally {
          await page.close();
        }
      }),
  );
  const libraryTask = () =>
    leg("real library", async () => {
      const page = await glBrowser.newPage();
      try {
        for (const doc of sceneDocs) {
          await page.goto(`${B}/a/${doc.id}/raw`);
          await page.waitForFunction(
            () =>
              document.querySelector("canvas")?.dataset.pixel ||
              document.querySelector("canvas")?.dataset.error,
            null,
            { timeout: 30000 },
          );
          const state = await page
            .locator("canvas")
            .evaluate((canvas) => ({ ...canvas.dataset }));
          check(
            !state.error,
            `authored module runs (${state.error ?? "no error"})`,
          );
          const pixel = JSON.parse(state.pixel ?? "[]");
          check(
            pixel[0] > pixel[1] * 2,
            "real three.js renders red WebGL pixels into authored canvas",
          );
          check(
            state.same === "true",
            "pinned repeated import shares the same module",
          );
        }
      } finally {
        await page.close();
      }
    });
  await pool([
    galleryTask,
    proseTask,
    libraryTask,
    ...responsiveTasks,
    ...stableTasks,
    ...themeTasks,
    ...shellTasks,
  ]);
  await owner.close();
  await guest.close();
} finally {
  await Promise.allSettled([browser.close(), glBrowser.close()]);
}
check.done();
