import { createHash } from "node:crypto";
import { createServer } from "node:http";
import { readFileSync } from "node:fs";
import { json } from "./server/text.ts";
import {
  createHostedStartup,
  installHostedStartup,
} from "./browser/hosted-startup.js";
import { runnerAddress, runnerLabel } from "./hosted-policy.ts";
const attr = (value) =>
  String(value)
    .replaceAll("&", "&amp;")
    .replaceAll('"', "&quot;")
    .replaceAll("<", "&lt;");
// Hash precisely the trusted inline bootstrap; authored app scripts remain isolated.
const startupScript = `(${installHostedStartup.toString()})(document,window,${createHostedStartup.toString()});`;
export const hostedStartupScriptPolicy = `'sha256-${createHash("sha256").update(startupScript).digest("base64")}'`;
export function hostedShell({ title, boot }) {
  return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${attr(title)}</title><!-- Platform shell. Canonical app HTML is available at the authorized alternate source URL. --><link rel="alternate" type="text/plain" href="${attr(boot.sourceUrl)}"><script id="pagegi-host" type="application/json">${json(boot)}</script><style>html,body{height:100%;margin:0}body{background:#f7f7f5;color:#252525;font-family:system-ui,sans-serif}#pg-startup{position:fixed;inset:0;z-index:20;display:grid;place-content:center;text-align:center;background:#f7f7f5;padding:24px}#pg-startup[hidden]{display:none}#pg-startup-title{font-size:20px;font-weight:550;margin:0 0 12px}#pg-startup-detail{font-size:14px;color:#666;margin:0 0 20px}#pg-startup-retry{justify-self:center;font:inherit;padding:8px 20px;border:1px solid #bbb;border-radius:6px;background:white;color:inherit;cursor:pointer}html:not([data-pagegi-startup=ready]) #pg-frame{visibility:hidden}#pg-frame{border:0;width:100%;height:100%}@media (prefers-color-scheme:dark){html:not([data-pagegi-theme=light]) body,html:not([data-pagegi-theme=light]) #pg-startup{background:#161618;color:#e8e8e6}html:not([data-pagegi-theme=light]) #pg-startup-detail{color:#a0a09c}html:not([data-pagegi-theme=light]) #pg-startup-retry{background:#26262a;border-color:#4a4a4e}}html[data-pagegi-theme=dark] body,html[data-pagegi-theme=dark] #pg-startup{background:#161618;color:#e8e8e6}html[data-pagegi-theme=dark] #pg-startup-detail{color:#a0a09c}html[data-pagegi-theme=dark] #pg-startup-retry{background:#26262a;border-color:#4a4a4e}</style><script src="/trusted-connection.js" data-pagegi-startup-script defer></script><script src="/runtime.js" data-pagegi-startup-script defer></script></head><body><section id="pg-startup" data-pagegi-ui role="status" aria-live="polite"><h1 id="pg-startup-title">Loading document</h1><p id="pg-startup-detail">Opening your document…</p><button id="pg-startup-retry" hidden>Try again</button></section><script>${startupScript}</script><iframe id="pg-frame" title="Document" sandbox="allow-scripts allow-same-origin allow-downloads allow-forms" referrerpolicy="no-referrer"></iframe></body></html>`;
}
export function serveRunner(req, res, platformOrigin, runnerOrigin) {
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("Referrer-Policy", "no-referrer");
  if (req.headers.host !== new URL(runnerOrigin).host) {
    res.writeHead(403);
    return res.end("Invalid runner host");
  }
  if (req.method === "GET" && req.url === "/runner") {
    res.setHeader("Content-Type", "text/html; charset=utf-8");
    res.setHeader(
      "Content-Security-Policy",
      `frame-ancestors ${platformOrigin}; base-uri 'none'; object-src 'none'`,
    );
    return res.end(
      `<!doctype html><html data-platform-origin="${attr(platformOrigin)}"><head><meta charset="utf-8"><title>Document runner</title><script src="/runner.js" defer></script></head><body></body></html>`,
    );
  }
  if (req.method === "GET" && req.url === "/runner.js") {
    res.setHeader("Content-Type", "text/javascript; charset=utf-8");
    try {
      return res.end(
        readFileSync(new URL("../dist/runner.js", import.meta.url)),
      );
    } catch {
      res.writeHead(503);
      return res.end("Runner unavailable");
    }
  }
  res.writeHead(404);
  res.end("Not found");
}
export function createHostedRunners(config = {}) {
  const runners = new Map();
  return {
    async address(document, platformOrigin) {
      if (config.runnerOrigin)
        return runnerAddress(runnerLabel(document), config);
      const key = platformOrigin + "|" + document;
      if (!runners.has(key))
        runners.set(
          key,
          (async () => {
            const host =
              new URL(platformOrigin).hostname === "localhost"
                ? "127.0.0.1"
                : "localhost";
            let origin;
            const server = createServer((req, res) =>
              serveRunner(req, res, platformOrigin, origin),
            );
            await new Promise((resolve, reject) => {
              server.once("error", reject);
              server.listen(0, "127.0.0.1", resolve);
            });
            origin = `http://${host}:${server.address().port}`;
            return { server, url: origin + "/runner" };
          })(),
        );
      return (await runners.get(key)).url;
    },
    async close() {
      await Promise.all(
        [...runners.values()].map(async (pending) => {
          const { server } = await pending;
          server.closeAllConnections();
          await new Promise((resolve) => server.close(resolve));
        }),
      );
      runners.clear();
    },
  };
}
