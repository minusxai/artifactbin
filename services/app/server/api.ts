/**
 * THE APP'S ROUTES ON HONO. Every handler keeps the signature it had —
 * `(request: Request, ctx: { params: Promise<...> })` → `Response` — so the
 * suite that calls handlers directly is unchanged, and Hono only translates:
 * its params become the promise the handler awaits, its raw Request is the
 * request. The table is generated from the filesystem (scripts/generate-routes).
 */
import type { Hono } from 'hono';
import { emit } from '@/lib/events';
import { runWithRequest } from '@/lib/request-context';
import { ROUTES, type RouteEntry } from './routes.generated';

type Handler = (request: Request, ctx: { params: Promise<Record<string, string>> }) => Promise<Response> | Response;

export function mountRoutes(app: Hono, routes: RouteEntry[] = ROUTES): void {
  for (const route of routes) {
    for (const method of route.methods) {
      const handler = route.module[method] as Handler;
      app.on(method, route.path, async (c) => {
        try {
          return await runWithRequest(c.req.raw, async () => handler(c.req.raw, { params: Promise.resolve(decodeParams(c.req.param())) }));
        } catch (error) {
          /*
           * A 500 the operator cannot read is an outage with no handle: the
           * framework's default handler answers and swallows, which is exactly
           * what a failing route inside the image looked like — `500 {}` to the
           * caller and a container log that said only that it had booted. The
           * caller still learns nothing (the text is ours, not theirs).
           */
          console.error(`[route] ${method} ${new URL(c.req.url).pathname} failed:`, error);
          /*
           * The same outage, counted. The object is the route PATTERN
           * (`GET /api/artifacts/:id`) and never the raw URL — that carries
           * artifact and token ids, and a log of 500s is exactly the place they
           * must not accumulate. The error TEXT stays in the operator's line
           * above for the same reason: it is whatever the throw said.
           *
           * `void`, not awaited: a 500 answers as fast as it can, and `emit`
           * never rejects.
           */
          void emit(null, 'failed', { kind: 'route', id: `${method} ${route.path}` }, { status: 500, method });
          return new Response('internal error', { status: 500 });
        }
      });
    }
  }
}

/** Hono hands params raw; Next decoded them. `[...rest]` arrives as one string, split like Next's array. */
function decodeParams(params: Record<string, string>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(params)) out[k] = safeDecode(v);
  return out;
}
const safeDecode = (v: string): string => { try { return decodeURIComponent(v); } catch { return v; } };
