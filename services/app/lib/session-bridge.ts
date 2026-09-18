/**
 * WHERE A BROWSER SESSION'S PAGE REQUESTS GO — the one hop that differs between
 * development and a deployment, decided here rather than inline in the composition.
 *
 * A session's scripted browser never reaches the network itself: every request its
 * pages make is forwarded by the parent (`forwardSessionFetch`) through the upstream
 * this module returns, as the actor the session browses as.
 *
 * IN A DEPLOYMENT that upstream is `inProcess(app)` — the same Request object, no
 * socket, the actor carried on the value. Nothing is faster or harder to forge.
 *
 * IN DEVELOPMENT that is wrong, and silently so. The SPA's modules are served by
 * Vite, which runs in FRONT of this process's listener (`server.ts`: the Vite chain
 * wraps the listener, not the app), so a session talking to the app object alone gets
 * 404 for `/@vite/client`, `/@react-refresh`, `/main.tsx` and `/shell.css`, and
 * `window.mx` is never defined — every session-driven gate and eval fails on a page
 * that looks fine in a real browser. So in development the hop goes over loopback
 * HTTP, through EXACTLY the chain a real browser's request travels, with the actor in
 * the same signed header a split deployment uses. The secret is generated per boot
 * (`server.ts`) and never leaves the process, so nothing outside it can mint an actor.
 */
import { inProcess, overHttp } from '@artifactbin/utils';
import type { Upstream } from '@artifactbin/contracts';
import type { Hono } from 'hono';

export interface SessionBridgeOptions {
  /** `NODE_ENV !== 'production'`; the loopback hop is development-only. */
  dev: boolean;
  /** The port THIS process listens on — the socket Vite's middleware is in front of. */
  port: number;
  /** The per-boot actor secret. Without one there is nothing to sign with, so the hop stays in-process. */
  secret?: string | undefined;
  /** The app, for the in-process hop. */
  app: Pick<Hono, 'fetch'>;
}

export function sessionBridge({ dev, port, secret, app }: SessionBridgeOptions): Upstream {
  if (dev && secret) return overHttp(`http://127.0.0.1:${port}`, secret);
  return inProcess(app);
}
