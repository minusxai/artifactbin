/**
 * THE APP'S OWN PAGES — every static address solid/App.tsx routes, and a profile (`/@name`). The server answers each
 * with the app shell (server/app: a direct load or a reload of a static address missing here is a 404); the app's
 * router follows a link to one from a framed document (solid/document/frame-navigation). Every other address — a
 * document's, its pretty alias, a file — is the server's to answer, by a full load.
 *
 * Value-only, no imports: the server and the client page both read it.
 */
export const SPA_PATHS = /^(\/|\/login|\/connect|\/start|\/account|\/notifications|\/welcome|\/chat|\/assets|\/trash|\/tokens|\/docs-human|\/getting-started|\/datasets\/new|\/files\/new|\/schedules|\/programs\/new|\/programs\/[^/]+\/edit)$/;
/** A profile page (server/app `/:user{@[a-z0-9_]+}`); `/@name/<slug>` is a document's pretty alias, not this. */
export const PROFILE_PATH = /^\/@[a-z0-9_]+$/;

/** The app's router draws this pathname without the server (a static page or a profile). */
export const isAppPagePath = (pathname: string): boolean => SPA_PATHS.test(pathname) || PROFILE_PATH.test(pathname);
