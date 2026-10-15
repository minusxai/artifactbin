/**
 * THE DEPLOYMENT'S BUILD — which build of the app's own code this server serves.
 *
 * A tab outlives deploys: the page it loaded names lazy chunks by content hash, and the server only
 * serves the current build's (server/build-assets), so after a deploy the old page's next lazy import
 * 404s. The page learns the server moved on BEFORE that happens through three carriers of one id:
 *
 *  - the app page's `<meta name="artifactbin-build">` (server/app `page`): the build the page itself is;
 *  - `x-artifactbin-build` on every app response (the page's data fetches read it);
 *  - the live doors' heartbeat (`event: keepalive`, `{"build":…}`), which every open stream hears
 *    within LIVE_KEEPALIVE_MS of reconnecting to a new server (lib/http/live-stream observeLiveBuild).
 *
 * The id is the build manifest's hash (server/build-assets appBuildId); a server with no built tree
 * (development, tests) has none, and every carrier is then silent. Framework-free and dependency-free:
 * both the server and the page import it.
 */
import { LIVE_KEEPALIVE_EVENT } from './live-stream';

/** The response header naming the server's build. */
export const APP_BUILD_HEADER = 'x-artifactbin-build';
/** The app page's meta naming the build the page was served from. */
export const APP_BUILD_META = 'artifactbin-build';

let current: string | null = null;

/** Set once at boot by the app server (server/app createAppServer). */
export function setAppBuild(id: string | null): void { current = id; }

/** This server's build, or null when it serves no built tree. */
export function appBuild(): string | null { return current; }

/** The live doors' heartbeat frame: the named event the client's watchdog counts, carrying the build. */
export function liveKeepaliveFrame(): string {
  return `event: ${LIVE_KEEPALIVE_EVENT}\ndata: ${current ? JSON.stringify({ build: current }) : '{}'}\n\n`;
}
