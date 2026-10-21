import { readFileSync } from "node:fs";
import { homePage } from "../home-page.js";
import { SKILL_ARCHIVE_PATH } from "../af-contracts.ts";
import { skillArchive } from "./skill-archive.ts";
import type {
  PlatformAssets,
  PlatformAssetOptions,
  PlatformAsset,
} from "./assets-contracts.ts";
/** A closed asset allowlist owns platform document CSP and approval copy. */
export function createPlatformAssets(
  _options: PlatformAssetOptions = {},
): PlatformAssets {
  const html = (body: string, csp?: string): PlatformAsset => ({
    body,
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      ...(csp ? { "Content-Security-Policy": csp } : {}),
    },
  });
  const scripts: Record<string, string> = {
    "/runtime.js": "../../dist/runtime.js",
    "/platform-frame.js": "../../dist/platform-frame.js",
    "/trusted-connection.js": "../../dist/trusted-connection.js",
    "/home.js": "../../dist/home.js",
    "/navigation.js": "../navigation.js",
    "/theme.js": "../theme.js",
    "/file-browser.js": "../file-browser.js",
    "/account.js": "../browser/account.js",
    "/sharing.js": "../browser/sharing.js",
    "/identity.js": "../browser/identity.js",
    "/connect.js": "../browser/connect.js",
  };
  return {
    resolve(method, url, request = { signedIn: true }) {
      // HEAD answers like GET; Node's response leaves the body out.
      if (method !== "GET" && method !== "HEAD") return null;
      const script = scripts[url.pathname];
      if (script)
        return {
          body: readFileSync(new URL(script, import.meta.url)),
          headers: { "Content-Type": "text/javascript; charset=utf-8" },
        };
      // The approval window a downloaded file opens to connect as the viewer (src/browser/connect.js).
      if (url.pathname === "/connect")
        return html(
          '<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Connect · Pagegi</title><style>body{margin:0;min-height:100vh;display:grid;place-content:center;font:15px/1.5 system-ui,sans-serif;background:#f7f7f5;color:#252525}main{max-width:26rem;padding:24px}h1{font-size:20px;font-weight:550;margin:0 0 12px}p{margin:0 0 12px}button,a.button{font:inherit;padding:8px 20px;border:1px solid #bbb;border-radius:6px;background:#1a2129;color:#fff;cursor:pointer;text-decoration:none;display:inline-block}[hidden]{display:none!important}</style><script src="/connect.js" defer></script></head><body><main><h1>Connect to Pagegi</h1><p id="page"></p><p id="who"></p><button id="approve" hidden>Approve connection</button><a id="sign-in" class="button" hidden>Sign in</a><p id="status" role="status" aria-live="polite"></p></main></body></html>',
          "default-src 'none'; script-src 'self'; style-src 'unsafe-inline'; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; object-src 'none'",
        );
      if (url.pathname === "/platform-frame")
        return html(
          '<!doctype html><html><head><meta charset="utf-8"><title>Platform connection</title><script src="/platform-frame.js" defer></script></head><body></body></html>',
          "default-src 'none'; script-src 'self'; connect-src 'self' ws: wss:; style-src 'unsafe-inline'; base-uri 'none'; object-src 'none'",
        );
      if (url.pathname === "/")
        return html(
          request.signedIn
            ? homePage
            : homePage.replace("<head>", '<head><meta name="pagegi-session" content="none">'),
          "default-src 'self'; img-src 'self' data: blob:; script-src 'self'; style-src 'self' 'unsafe-inline'; font-src 'self' data:; frame-src 'self'; frame-ancestors " +
            (url.searchParams.has("embed")
              ? "'self' http://localhost:* http://127.0.0.1:* file:"
              : "'none'") +
            "; base-uri 'none'",
        );
      // The author skill for an agent to install; cacheable, unlike the rest of the platform.
      if (url.pathname === SKILL_ARCHIVE_PATH) return skillArchive();
      return null;
    },
  };
}
