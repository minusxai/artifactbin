/**
 * The real-socket fixture moved to `@artifactbin/test-support` — `services/browser` was reaching across
 * a package boundary into this directory to import it, which is what a missing shared package looks like.
 *
 * This re-export exists only so the app's own tests keep their import path while that workstream lands;
 * it is a hand-off seam, not an API. Point new tests at `@artifactbin/test-support`.
 */
export { freePort, withHttpServer, type RunningServer } from '@artifactbin/test-support/net';
