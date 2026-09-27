/**
 * THE ADDRESS BAR, HEALED IN PLACE — the entry's FIRST import, so it runs before
 * any other module body: before the router is created, before the initial story
 * is captured against the current path, before any inlined data is looked up by
 * path (web/bootstrap takeBootstrap).
 *
 * A readable document requested at a non-canonical address is served directly
 * rather than redirected (server/app documentAddress): one round trip fewer for
 * every shared `/a/<id>` link. The page data names the canonical path, and this
 * puts it in the address bar with `replaceState` — no new history entry, the
 * query and fragment kept — exactly where the old redirect would have left it.
 * Only a same-origin absolute path is ever written.
 */
import { canonicalAddress } from './bootstrap';

const address = canonicalAddress();
if (address && /^\/(?![/\\])/.test(address) && address !== window.location.pathname) {
  window.history.replaceState(window.history.state, '', address + window.location.search + window.location.hash);
}
