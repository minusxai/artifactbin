/**
 * THE ONE WAY A GATE LAUNCHES CHROMIUM.
 *
 * Every document is served on its own origin under the pages host (`<hex id>.lvh.me`), framed by the app
 * page at `app.lvh.me`; the two are the same site, so the pages cookie flows into the frame. `*.lvh.me`
 * resolves to loopback on the public DNS, which a gate container may not have, so the browser is told the
 * mapping outright and this process's own resolver learns it too (fixture fetches hit the same hosts).
 */
import dns from 'node:dns';
import { chromium } from 'playwright';

export const PAGES_HOST = 'lvh.me';

const realLookup = dns.lookup;
/** @type {typeof dns.lookup} */
const lookup = function (hostname, options, callback) {
  if (typeof hostname === 'string' && (hostname === PAGES_HOST || hostname.endsWith(`.${PAGES_HOST}`))) {
    const cb = typeof options === 'function' ? options : callback;
    const all = typeof options === 'object' && options !== null && options.all;
    process.nextTick(() => (all ? cb(null, [{ address: '127.0.0.1', family: 4 }]) : cb(null, '127.0.0.1', 4)));
    return;
  }
  return realLookup.call(dns, hostname, options, callback);
};
if (!dns.lookup.__gatesPagesHost) {
  lookup.__gatesPagesHost = true;
  dns.lookup = lookup;
}

/** Chromium args that map the pages host and its subdomains to loopback. */
export const PAGES_BROWSER_ARGS = [`--host-resolver-rules=MAP *.${PAGES_HOST} 127.0.0.1, MAP ${PAGES_HOST} 127.0.0.1`];

/**
 * `chromium.launch` with the pages-host mapping folded into `args`; every other option passes through.
 * @param {import('playwright').LaunchOptions} [options]
 */
export function launchChromium(options = {}) {
  return chromium.launch({ ...options, args: [...PAGES_BROWSER_ARGS, ...(options.args ?? [])] });
}
