import type { Env, Hono } from 'hono';
import type { Actor } from './actor';

/**
 * A PART: one named behaviour of a proxy or app — a middleware, a route group,
 * the forwarder. A service is an ORDERED LIST of parts; `assemble()` (utils)
 * turns the list into a Hono app and lets a downstream replace, remove or
 * append parts BY NAME. This is the whole extension mechanism: there is no
 * plugin system, no hooks, only the list.
 */
export interface Part<E extends Env = any> {
  name: string;
  mount: (app: Hono<E>) => void;
}

/**
 * THE UPSTREAM SEAM — how a proxy reaches the app it fronts. One signature,
 * two adapters (utils): in-process (`app.fetch` with the actor attached to
 * the Request) and over HTTP (a signed header, a streamed body). The app
 * cannot tell which one is in front of it; that is the test of the design.
 */
export type Upstream = (request: Request, actor: Actor) => Promise<Response>;
