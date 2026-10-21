import https from "node:https";
import http from "node:http";
import net from "node:net";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
import assert from "node:assert/strict";
import { chromium, firefox, webkit } from "playwright";
import { createPairing } from "./pairing.mjs";
import { createPolicy, route } from "./policy.mjs";
const temp = await mkdtemp(join(tmpdir(), "auth-proof-")),
  p = createPolicy(),
  pairs = createPairing(p),
  requests = [],
  issued = [],
  sockets = new Set();
let server, proxy, preview;
const page = (code) => '<!doctype html><meta charset="utf-8">' + code;
const frame =
  page(`<button id="signin" disabled>Connect</button><output id="status">idle</output><script>
(async()=>{const hex=b=>Array.from(new Uint8Array(b),v=>v.toString(16).padStart(2,'0')).join('');const verifier=hex(crypto.getRandomValues(new Uint8Array(32)));const challenge=hex(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(verifier)));const channel=hex(crypto.getRandomValues(new Uint8Array(16)));let popup;let token;const status=document.querySelector('#status');const req={documentId:'a',channel,challenge};document.querySelector('#signin').onclick=()=>{parent.postMessage({type:'clicked'},'*');popup=window.open('/login?'+new URLSearchParams(req),'_blank','popup');status.textContent=popup?'waiting':'popup-denied';if(popup)setTimeout(()=>{if(status.textContent==='waiting'){status.textContent='login-timeout';popup=null;}},1500);};document.querySelector('#signin').disabled=false;parent.postMessage({type:'boot-ready',channel},'*');addEventListener('message',async e=>{if(e.source===parent&&e.data?.type==='chrome-offer'&&e.data.version===1&&e.data.channel===channel&&typeof e.data.topbar==='boolean'&&typeof e.data.modals==='boolean'){parent.postMessage({type:'chrome-accepted',origin:e.origin},e.origin==='null'?'*':e.origin);return;}if(!popup||e.source!==popup||e.origin!==location.origin||e.data?.type!=='grant'||e.data.channel!==channel)return;try{const r=await fetch('/redeem',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({...req,verifier,code:e.data.code})});if(!r.ok)throw Error();token=(await r.json()).token;const checks=await Promise.all(['source','raw','history','shell'].map(async kind=>(await fetch('/docs/a/'+kind,{headers:{Authorization:'Bearer '+token}})).status));status.textContent=checks.every(x=>x===200)?'connected':'denied';parent.postMessage({type:'status',connected:status.textContent==='connected'},'*');}catch{status.textContent='denied';}});})();</script>`);
const pairFrame = page(
  `<output>Pairing</output><script>(async()=>{const hex=b=>Array.from(new Uint8Array(b),v=>v.toString(16).padStart(2,'0')).join('');const verifier=hex(crypto.getRandomValues(new Uint8Array(32))),challenge=hex(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(verifier))),channel=hex(crypto.getRandomValues(new Uint8Array(16)));const request={documentId:'a',channel,challenge};const post=(path,body)=>fetch(path,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});const r=await post('/pair-begin',request);const {requestId}=await r.json();parent.postMessage({type:'pair-ready',url:location.origin+'/pair-login?id='+requestId},'*');const end=Date.now()+60000;while(Date.now()<end){const res=await post('/pair-poll',{requestId,verifier});if(res.status===200){const session=await res.json();const source=await fetch('/docs/a/source',{headers:{Authorization:'Bearer '+session.token}});parent.postMessage({type:'paired',connected:source.ok},'*');return;}if(res.status!==202){parent.postMessage({type:'pair-failed'},'*');return;}await new Promise(r=>setTimeout(r,100));}parent.postMessage({type:'pair-expired'},'*');})();</script>`,
);
try {
  execFileSync(
    "openssl",
    [
      "req",
      "-x509",
      "-newkey",
      "rsa:2048",
      "-nodes",
      "-keyout",
      join(temp, "key.pem"),
      "-out",
      join(temp, "cert.pem"),
      "-subj",
      "/CN=platform.test",
      "-days",
      "1",
      "-addext",
      "subjectAltName=DNS:platform.test,DNS:embed.test,DNS:doc-a.content.test,DNS:doc-b.content.test",
    ],
    { stdio: "ignore" },
  );
  server = https.createServer(
    {
      key: await readFile(join(temp, "key.pem")),
      cert: await readFile(join(temp, "cert.pem")),
    },
    async (req, res) => {
      const host = req.headers.host.split(":")[0],
        url = new URL(req.url, "https://" + host);
      requests.push({
        host,
        path: url.pathname,
        cookie: req.headers.cookie || "",
        url: req.url,
      });
      res.setHeader("Cache-Control", "no-store");
      res.setHeader("Content-Type", "text/html");
      const send = (status, body) => {
        res.statusCode = status;
        res.end(body);
      };
      const json = (status, obj) => {
        res.setHeader("Content-Type", "application/json");
        send(status, JSON.stringify(obj));
      };
      let body = "";
      for await (const b of req) body += b;
      if (host === "embed.test" && url.pathname === "/")
        return send(
          200,
          page(
            '<iframe src="https://platform.test/frame"></iframe><script>window.messages=[];addEventListener("message",e=>{messages.push(e.data);if(e.data?.type==="boot-ready")e.source.postMessage({type:"chrome-offer",version:1,channel:e.data.channel,topbar:true,modals:true},"https://platform.test");});</script>',
          ),
        );
      if (host === "platform.test" && url.pathname === "/shell.js") {
        res.setHeader("Content-Type", "application/javascript");
        return send(
          200,
          "const frame=document.querySelector('iframe');addEventListener('message',async e=>{if(e.source!==frame.contentWindow||e.origin!=='https://doc-a.content.test')return;if(e.data?.type==='ready'&&e.data.version===1){const r=await fetch('/hosted-source');if(r.ok)frame.contentWindow.postMessage({type:'mount',version:1,channel:e.data.channel,source:await r.text()},e.origin);}if(e.data?.type==='rendered')document.querySelector('#hosted-status').textContent='rendered';});",
        );
      }
      if (host === "platform.test" && url.pathname === "/hosted") {
        res.setHeader(
          "Link",
          '</docs/a/source>; rel=alternate; type="text/plain"',
        );
        res.setHeader("Content-Security-Policy", "frame-ancestors 'none'");
        if (!req.headers.cookie?.includes("__Host-account=fixture-account"))
          return send(403, "denied");
        return send(
          200,
          page(
            `<!-- Canonical author source: /docs/a/source --><link rel="alternate" type="text/plain" href="/docs/a/source"><iframe sandbox="allow-scripts allow-same-origin" src="https://doc-a.content.test/runner"></iframe><output id="hosted-status">waiting</output><script src="/shell.js" defer></script>`,
          ),
        );
      }
      if (
        host === "platform.test" &&
        (url.pathname === "/hosted-source" ||
          (url.pathname === "/docs/a/source" &&
            req.headers.cookie?.includes("__Host-account=fixture-account")))
      ) {
        res.setHeader("ETag", '"fixture-rev-1"');
        res.setHeader("Content-Type", "text/plain");
        if (!req.headers.cookie?.includes("__Host-account=fixture-account"))
          return send(403, "denied");
        return send(
          200,
          page(
            '<h1>Private source delivered</h1><script>window.appExecuted=true;try{parent.document.body;window.parentBlocked=false}catch{window.parentBlocked=true}parent.postMessage({type:"rendered"},"https://platform.test");</script>',
          ),
        );
      }
      if (/^doc-[ab]\.content\.test$/.test(host) && url.pathname === "/runner")
        return send(
          200,
          page(
            `<script>(()=>{const channel=crypto.randomUUID();let mounted=false;addEventListener('message',e=>{if(mounted||e.source!==parent||e.origin!=='https://platform.test'||e.data?.type!=='mount'||e.data.version!==1||e.data.channel!==channel||typeof e.data.source!=='string')return;mounted=true;document.open();document.write(e.data.source);document.close();});parent.postMessage({type:'ready',version:1,channel},'https://platform.test');})();</script>`,
          ),
        );
      if (
        host === "platform.test" &&
        ["/pair-approve", "/grant"].includes(url.pathname) &&
        req.headers.origin !== "https://platform.test"
      )
        return json(403, { error: "origin-denied" });
      if (host === "platform.test" && url.pathname === "/pair-frame")
        return send(200, pairFrame);
      if (host === "platform.test" && url.pathname === "/pair-begin") {
        try {
          return json(200, pairs.begin(JSON.parse(body)));
        } catch {
          return json(403, {});
        }
      }
      if (host === "platform.test" && url.pathname === "/pair-poll") {
        try {
          const input = JSON.parse(body),
            session = pairs.poll(input.requestId, input.verifier);
          if (!session) return json(202, {});
          issued.push(session.token);
          return json(200, session);
        } catch {
          return json(403, {});
        }
      }
      if (host === "platform.test" && url.pathname === "/pair-login") {
        try {
          const info = pairs.describe(url.searchParams.get("id"));
          res.setHeader("Cross-Origin-Opener-Policy", "same-origin");
          return send(
            200,
            page(
              `<h1>Connect document ${info.documentId}</h1><button id="approve">Sign in and approve this document</button><output id="result"></output><script>document.querySelector('#approve').onclick=async()=>{await fetch('/fixture-login',{method:'POST'});const r=await fetch('/pair-approve',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({requestId:new URLSearchParams(location.search).get('id')})});document.querySelector('#result').textContent=r.ok?'approved':'denied';};</script>`,
            ),
          );
        } catch {
          return send(403, "expired");
        }
      }
      if (host === "platform.test" && url.pathname === "/pair-approve") {
        try {
          pairs.approve(
            req.headers.cookie?.includes("__Host-account=fixture-account")
              ? "fixture-account"
              : undefined,
            JSON.parse(body).requestId,
          );
          return json(200, {});
        } catch {
          return json(403, {});
        }
      }
      if (host === "platform.test" && url.pathname === "/frame")
        return send(200, frame);
      if (host === "platform.test" && url.pathname === "/login") {
        if (url.searchParams.get("coop") === "1")
          res.setHeader("Cross-Origin-Opener-Policy", "same-origin");
        return send(
          200,
          page(
            `<button id="login">Sign in to fixture account</button><script>document.querySelector('#login').onclick=async()=>{await fetch('/fixture-login',{method:'POST'});const req=Object.fromEntries(new URLSearchParams(location.search));const r=await fetch('/grant',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(req)});const g=await r.json();opener.postMessage({type:'grant',code:g.code,channel:req.channel},location.origin);document.body.textContent='complete';};</script>`,
          ),
        );
      }
      if (host === "platform.test" && url.pathname === "/fixture-login") {
        res.setHeader(
          "Set-Cookie",
          "__Host-account=fixture-account; Secure; HttpOnly; Path=/; SameSite=Strict",
        );
        return json(200, {});
      }
      if (host === "platform.test" && url.pathname === "/grant") {
        try {
          const g = p.issue(
            req.headers.cookie?.includes("__Host-account=fixture-account")
              ? "fixture-account"
              : undefined,
            JSON.parse(body),
          );
          issued.push(g.code);
          return json(200, g);
        } catch {
          return json(403, {});
        }
      }
      if (host === "platform.test" && url.pathname === "/redeem") {
        try {
          const s = p.redeem(JSON.parse(body));
          issued.push(s.token);
          return json(200, s);
        } catch {
          return json(403, {});
        }
      }
      if (
        /^doc-[ab]\.content\.test$/.test(host) &&
        url.pathname === "/storage-fixture"
      )
        return send(
          200,
          page(
            `<script>window.before=localStorage.getItem('marker');localStorage.setItem('marker',location.hostname);document.cookie='marker='+location.hostname+';Secure;SameSite=Strict;Path=/';</script>`,
          ),
        );
      const doc = /\/(?:docs|app)\/([ab])/.exec(url.pathname)?.[1];
      const token = req.headers.authorization?.replace(/^Bearer /, "");
      return send(
        route(host, url.pathname, p.authorize(token, doc)).status,
        page("private fixture"),
      );
    },
  );
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  const port = server.address().port;
  proxy = http.createServer((req, res) => {
    if (req.url === "http://preview.test/") {
      res.setHeader("Content-Type", "text/html");
      res.end(
        page(
          '<iframe src="https://platform.test/frame"></iframe><script>window.messages=[];addEventListener("message",e=>{messages.push(e.data);if(e.data?.type==="boot-ready")e.source.postMessage({type:"chrome-offer",version:1,channel:e.data.channel,topbar:true,modals:true},"https://platform.test");});</script>',
        ),
      );
      return;
    }
    res.writeHead(403);
    res.end();
  });
  proxy.on("connect", (req, socket, head) => {
    if (
      !/^(platform\.test|embed\.test|doc-[ab]\.content\.test):443$/.test(
        req.url,
      )
    ) {
      socket.end("HTTP/1.1 403 Forbidden\r\n\r\n");
      return;
    }
    sockets.add(socket);
    socket.on("close", () => sockets.delete(socket));
    const upstream = net.connect(port, "127.0.0.1", () => {
      socket.write("HTTP/1.1 200 Connection Established\r\n\r\n");
      if (head.length) upstream.write(head);
      socket.pipe(upstream);
      upstream.pipe(socket);
    });
    upstream.on("error", () => socket.destroy());
    socket.on("error", () => upstream.destroy());
  });
  await new Promise((r) => proxy.listen(0, "127.0.0.1", r));
  preview = http.createServer((req, res) => {
    res.setHeader("Content-Type", "text/html");
    res.end(
      page(
        '<iframe src="https://platform.test/frame"></iframe><script>window.messages=[];addEventListener("message",e=>messages.push(e.data));</script>',
      ),
    );
  });
  await new Promise((r) => preview.listen(0, "127.0.0.1", r));
  for (const [name, engine] of Object.entries(
    process.argv.includes("--firefox-headed")
      ? { firefox }
      : { chromium, firefox, webkit },
  )) {
    const browser = await engine.launch({
      headless: !process.argv.includes("--firefox-headed"),
      proxy: {
        server: "http://127.0.0.1:" + proxy.address().port,
        bypass: "127.0.0.1,localhost",
      },
    });
    try {
      const context = await browser.newContext({ ignoreHTTPSErrors: true });
      const tab = await context.newPage();
      await tab.goto("https://embed.test/");
      const f = tab.frameLocator("iframe");
      await f.locator("#signin").waitFor();
      // Deliberately block persistent Web Storage in the frame. Login must use memory + first-party popup only.
      const frameObject = tab
        .frames()
        .find((f) => f.url() === "https://platform.test/frame");
      await frameObject.evaluate(() => {
        Object.defineProperty(document, "cookie", {
          get() {
            throw new DOMException("blocked", "SecurityError");
          },
          set() {
            throw new DOMException("blocked", "SecurityError");
          },
        });
        document.requestStorageAccess = () =>
          Promise.reject(new DOMException("blocked", "NotAllowedError"));
        for (const key of ["localStorage", "sessionStorage"])
          Object.defineProperty(window, key, {
            get() {
              throw new DOMException("blocked", "SecurityError");
            },
          });
      });
      await tab.evaluate(() =>
        document
          .querySelector("iframe")
          .contentWindow.postMessage(
            { type: "grant", code: "forged", channel: "forged" },
            "https://platform.test",
          ),
      );
      assert.equal(await f.locator("#status").textContent(), "idle");
      const popupPromise = context.waitForEvent("page");
      await f.locator("#signin").click({ noWaitAfter: true });
      const popup = await popupPromise;
      await popup.waitForLoadState();
      await popup.locator("#login").click();
      await f.locator("#status").filter({ hasText: "connected" }).waitFor();
      assert.ok(
        await tab.evaluate(() =>
          messages.some(
            (m) =>
              m.type === "chrome-accepted" && m.origin === "https://embed.test",
          ),
        ),
      );
      assert.deepEqual(
        await tab.evaluate(() =>
          window.messages.filter((m) => m.type === "status"),
        ),
        [{ type: "status", connected: true }],
      );
      assert.equal(
        await tab.evaluate(() => {
          try {
            return document.querySelector("iframe").contentDocument.body
              .innerHTML;
          } catch {
            return null;
          }
        }),
        null,
      );
      for (const kind of ["source", "raw", "history", "shell"]) {
        const result = await context.request.get(
          "https://platform.test/docs/a/" + kind,
          { headers: { Cookie: "" } },
        );
        assert.equal(result.status(), 403);
      }
      // Platform account cookie must not appear on either document origin. Separate origins cannot share storage.
      const doc = await context.newPage();
      await doc.goto("https://doc-a.content.test/storage-fixture");
      assert.equal(await doc.evaluate(() => window.before), null);
      await doc.goto("https://doc-b.content.test/storage-fixture");
      assert.equal(await doc.evaluate(() => window.before), null);
      await doc.goto("https://doc-a.content.test/storage-fixture");
      assert.equal(
        await doc.evaluate(() => window.before),
        "doc-a.content.test",
      );
      assert.equal(
        (
          await context.request.get("https://doc-a.content.test/app/a")
        ).status(),
        403,
      );
      assert.equal(
        (
          await context.request.get("https://doc-a.content.test/app/b")
        ).status(),
        404,
      );
      assert.ok(
        requests
          .filter((r) => r.host.startsWith("doc-"))
          .every((r) => !r.cookie.includes("__Host-account")),
      );
      assert.ok(
        requests
          .filter((r) => r.path === "/redeem")
          .every((r) => !r.cookie.includes("__Host-account")),
        "cross-site frame did not use Strict account cookie",
      );
      const html = await tab.content();
      for (const secret of issued) {
        assert.ok(!html.includes(secret));
        assert.ok(requests.every((r) => !r.url.includes(secret)));
      }
      await frameObject.evaluate(() => {
        window.open = () => null;
      });
      await f.locator("#signin").click({ noWaitAfter: true });
      assert.equal(await f.locator("#status").textContent(), "popup-denied");
      // A private app is delivered by an authenticated shell to a public, empty document-origin runner.
      const hosted = await context.newPage();
      const shellResponse = await hosted.goto("https://platform.test/hosted");
      assert.ok(shellResponse.headers().link.includes("/docs/a/source"));
      assert.equal(
        await hosted.locator("link[rel=alternate]").getAttribute("href"),
        "/docs/a/source",
      );
      const authorSource = await context.request.get(
        "https://platform.test/docs/a/source",
      );
      assert.equal(authorSource.status(), 200);
      assert.equal(authorSource.headers().etag, '"fixture-rev-1"');
      await hosted
        .locator("#hosted-status")
        .filter({ hasText: "rendered" })
        .waitFor();
      const app = hosted
        .frames()
        .find((f) => f.url() === "https://doc-a.content.test/runner");
      assert.equal(
        await app.evaluate(() => appExecuted && parentBlocked),
        true,
      );
      assert.ok(!(await app.content()).includes("fixture-account"));
      assert.equal(
        (
          await context.request.get("https://doc-a.content.test/hosted-source")
        ).status(),
        404,
      );
      const anon = await browser.newContext({ ignoreHTTPSErrors: true });
      assert.equal(
        (
          await anon.request.get("https://platform.test/hosted-source")
        ).status(),
        403,
      );
      await anon.close();
      // Navigating the credential frame destroys its verifier and expected popup binding.
      await tab.reload();
      await tab.frameLocator("iframe").locator("#signin").waitFor();
      const stalePopupPromise = context.waitForEvent("page");
      await tab
        .frameLocator("iframe")
        .locator("#signin")
        .click({ noWaitAfter: true });
      const stalePopup = await stalePopupPromise;
      await stalePopup.waitForLoadState();
      await tab.evaluate(
        () =>
          (document.querySelector("iframe").src =
            "https://platform.test/frame?new-session"),
      );
      await tab.frameLocator("iframe").locator("#signin").waitFor();
      await stalePopup.locator("#login").click();
      await tab.waitForTimeout(150);
      assert.equal(
        await tab.frameLocator("iframe").locator("#status").textContent(),
        "idle",
      );
      // Incompatible COOP intentionally severs the opener. Never silently call this connected.
      if (name === "chromium") {
        const freshFrame = tab
          .frames()
          .find((f) => f.url().includes("/frame?"));
        await freshFrame.evaluate(() => {
          const open = window.open.bind(window);
          window.open = (url, ...args) => open(url + "&coop=1", ...args);
        });
        const coopPromise = context.waitForEvent("page");
        await tab
          .frameLocator("iframe")
          .locator("#signin")
          .dispatchEvent("click");
        const coopPopup = await coopPromise;
        await coopPopup.waitForLoadState();
        assert.equal(await coopPopup.evaluate(() => opener === null), true);
        await tab
          .frameLocator("iframe")
          .locator("#status")
          .filter({ hasText: "login-timeout" })
          .waitFor();
      } else {
        const timeoutFrame = tab
          .frames()
          .find((f) => f.url().includes("/frame?"));
        await timeoutFrame.evaluate(() => {
          window.open = () => ({});
          document.querySelector("#signin").click();
        });
        await tab
          .frameLocator("iframe")
          .locator("#status")
          .filter({ hasText: "login-timeout" })
          .waitFor();
      }
      // file:// is opaque but retains exact child-window / direct-popup trust boundary.
      const fileContext = await browser.newContext({ ignoreHTTPSErrors: true });
      const fileTab = await fileContext.newPage();
      const filePath = join(temp, name + ".html");
      await writeFile(
        filePath,
        page(
          '<iframe src="https://platform.test/frame"></iframe><script>window.messages=[];addEventListener("message",e=>{messages.push(e.data);if(e.data?.type==="boot-ready")e.source.postMessage({type:"chrome-offer",version:1,channel:e.data.channel,topbar:true,modals:true},"https://platform.test");});</script>',
        ),
      );
      await fileTab.goto("file://" + filePath);
      await fileTab.waitForFunction(() =>
        messages.some((m) => m.type === "boot-ready"),
      );
      if (name === "firefox" && !process.argv.includes("--firefox-headed")) {
        await fileTab.goto("http://127.0.0.1:" + preview.address().port + "/");
        await fileTab.waitForFunction(() =>
          messages.some((m) => m.type === "boot-ready"),
        );
      }
      await fileTab.bringToFront();
      const filePopupPromise = fileContext.waitForEvent("page");
      // Genuine locator activation waits for layout/enabled state; fixed coordinates
      // can hit the wrong surface before a freshly loaded file iframe is painted.
      await fileTab.frameLocator("iframe").locator("#signin").click({ noWaitAfter: true });
      const filePopup = await filePopupPromise;
      await filePopup.waitForLoadState();
      await filePopup.locator("#login").click();
      await fileTab.waitForFunction(() =>
        messages.some((m) => m.type === "status" && m.connected),
      );
      assert.deepEqual(
        await fileTab.evaluate(() =>
          messages.filter((m) => m.type === "status"),
        ),
        [{ type: "status", connected: true }],
      );
      await fileContext.close();
      // Opener-independent pairing: public link in the local parent, secrets only in trusted frame.
      const pairContext = await browser.newContext({ ignoreHTTPSErrors: true });
      const pairTab = await pairContext.newPage();
      const pairPath = join(temp, name + "-pair.html");
      await writeFile(
        pairPath,
        page(
          '<a id="connect" target="_blank" rel="noopener">Connect remote</a><iframe src="https://platform.test/pair-frame"></iframe><script>window.messages=[];addEventListener("message",e=>{if(e.source!==document.querySelector("iframe").contentWindow||e.origin!=="https://platform.test")return;messages.push(e.data);if(e.data.type==="pair-ready")document.querySelector("#connect").href=e.data.url;});</script>',
        ),
      );
      await pairTab.goto("file://" + pairPath);
      await pairTab.locator("#connect[href]").waitFor();
      const publicURL = await pairTab.locator("#connect").getAttribute("href");
      const publicId = new URL(publicURL).searchParams.get("id");
      assert.equal(
        (
          await pairContext.request.post("https://platform.test/pair-approve", {
            headers: { Origin: "https://embed.test" },
            data: { requestId: publicId },
          })
        ).status(),
        403,
      );
      assert.equal(
        (
          await pairContext.request.post("https://platform.test/pair-poll", {
            data: { requestId: publicId, verifier: "attacker" },
          })
        ).status(),
        403,
      );
      const pairPopupPromise = pairContext.waitForEvent("page");
      await pairTab.locator("#connect").click();
      const pairPopup = await pairPopupPromise;
      await pairPopup.waitForLoadState();
      assert.equal(await pairPopup.evaluate(() => opener === null), true);
      assert.equal(
        await pairPopup.locator("h1").textContent(),
        "Connect document a",
      );
      await pairPopup.locator("#approve").click();
      await pairTab.waitForFunction(() =>
        messages.some((m) => m.type === "paired" && m.connected),
      );
      const pairHTML = await pairTab.content(),
        pairMessages = await pairTab.evaluate(() => JSON.stringify(messages));
      for (const secret of issued) {
        assert.ok(!pairHTML.includes(secret));
        assert.ok(!pairMessages.includes(secret));
        assert.ok(requests.every((r) => !r.url.includes(secret)));
      }
      assert.ok(
        requests
          .filter((r) => r.path === "/pair-poll")
          .every((r) => !r.cookie.includes("__Host-account")),
      );
      await pairContext.close();

      console.log(
        JSON.stringify({
          engine: name,
          arbitraryParentChrome: true,
          directFilePairing: true,
          pairingWithoutOpener: true,
          hostedPrivateApp: true,
          directFileMode: name !== "firefox",
          previewFallback: name === "firefox",
          navigationInvalidatesHandshake: true,
          loginTimeoutExplicit: true,
          actualCoopSevering: name === "chromium",
          httpsCrossSitePopupHandoff: true,
          storageDisabled: true,
          forgedMessageRejected: true,
          privateRepresentationsDenied: true,
          documentStorageIsolated: true,
          accountCookieIsolated: true,
          noSecretInParentOrURLs: true,
          popupDeniedExplicit: true,
        }),
      );
      await context.close();
    } finally {
      await browser.close();
    }
  }
} finally {
  preview?.closeAllConnections();
  preview?.close();
  for (const socket of sockets) socket.destroy();
  server?.closeAllConnections();
  await new Promise((r) => (server ? server.close(r) : r()));
  await new Promise((r) => (proxy ? proxy.close(r) : r()));
  await rm(temp, { recursive: true, force: true });
}
