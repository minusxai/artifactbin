/**
 * THE ONE WAY A GATE LAUNCHES A BROWSER.
 *
 * Every document is served on its own origin under the pages host (`<hex id>.lvh.me`), framed by the app
 * page at `app.lvh.me`; the two are the same site, so the pages cookie flows into the frame. `*.lvh.me`
 * resolves to loopback on the public DNS, which a gate container may not have, so nothing here asks it:
 * this process resolves every loopback name itself (utils/node/loopback-lookup, installed on import, so
 * fixture fetches hit the same hosts), Chromium is told the mapping by flag, and WebKit — which has no such
 * switch — connects through a proxy in this process that resolves the same way (lib/loopback-proxy).
 */
import { chromium, webkit } from 'playwright';
import { useLoopbackLookup } from '@artifactbin/utils/node/loopback-lookup';
import { startLoopbackProxy } from './loopback-proxy.mjs';

export const PAGES_HOST = 'lvh.me';

useLoopbackLookup();

/** Chromium args that map the pages host and its subdomains to loopback. */
export const PAGES_BROWSER_ARGS = [`--host-resolver-rules=MAP *.${PAGES_HOST} 127.0.0.1, MAP ${PAGES_HOST} 127.0.0.1`];

/**
 * `chromium.launch` with the pages-host mapping folded into `args`; every other option passes through.
 * @param {import('playwright').LaunchOptions} [options]
 */
export function launchChromium(options = {}) {
  return chromium.launch({ ...options, args: [...PAGES_BROWSER_ARGS, ...(options.args ?? [])] });
}

/** @type {Promise<{ server: string }> | null} */
let proxy = null;
/**
 * `webkit.launch` through this process's loopback proxy (one per process, started on first use), so WebKit
 * reaches the app and every document origin with no DNS; every other option passes through.
 * @param {import('playwright').LaunchOptions} [options]
 */
export async function launchWebKit(options = {}) {
  const { server } = await (proxy ??= startLoopbackProxy());
  return webkit.launch({ ...options, proxy: { server } });
}
