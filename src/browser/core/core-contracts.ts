/**
 * The core script, `/af/v1/core.js` (owner: brief A). Entry:
 * src/browser/core/core.ts, bundled by scripts/build.js to dist/core.js as a
 * classic script. Authors load it first in <head>:
 *   <script src="https://artifactbin.dev/af/v1/core.js"></script>
 *
 * Runs in the page's own realm, so it never holds an account token: requests
 * that need one go through the existing platform frame
 * (src/browser/platform-frame.ts / trusted-connection.ts) by postMessage.
 * src/browser/core/core.ts is an app entry for scripts/check-boundaries.ts:
 * it must not import credential modules.
 *
 * The platform origin is the origin of the core's own `src`
 * (`document.currentScript.src`). An inline core (a downloaded file) has no
 * src; its design-system link is already in the page, right after it. A
 * hosted page's runner puts the page's own design system's CSS in such a link
 * just before the core (src/browser/surface.js), so the core finds it
 * synchronously and fetches nothing for the first paint.
 *
 * Synchronously, before any module script runs, the core:
 *  1. inserts `<script type="importmap">` immediately before itself, mapping
 *     every `@afbin/*` module it provides (`@afbin/apollo`) to a URL it
 *     controls (a blob: URL, so it also works in a downloaded file);
 *  2. sets `data-af-design-system` (and `data-af-dark="true"` in dark mode)
 *     on <html> from resolveAppearance;
 *  3. inserts `<link rel="stylesheet" data-af="design-system"
 *     href="${platform origin}/af/v1/design-systems/<name>.css">` immediately
 *     after itself, unless one is already there (a downloaded file, or a hosted
 *     page with the CSS inline before the core: that link is kept and gets a
 *     network href only when the viewer picks another system).
 * Resulting order in <head>: import map, core, design-system link (or, hosted:
 * inline design-system link, import map, core).
 * Then it builds the `@afbin/apollo` client over the viewer's own local state
 * (kept in browser storage: the hosted bridge's store keyed by the page, or
 * standalone.ts persistentStore for a page opened on its own), seeded from a
 * `data-af="state"` block and replaced once by `#af-state=` on the address;
 * and with a RemotePort to POST /api/files/:id/graphql when the page links backends.
 * When the viewer switches design system or mode, it updates the attributes
 * and the link's href. It also mounts the platform chrome (toolbar, comments,
 * sign-in, dark-mode switch, design-system picker); pages never build these.
 */
import type { DesignSystemName } from "../../af-contracts.ts";

export interface AppearanceInput {
  /** `data-af-design-system` written in the page source, if any. */
  pageDesignSystem: string | null;
  /** The viewer's own pick, if any (remembered per viewer, never saved in the page). */
  viewerDesignSystem: string | null;
  /** The viewer's explicit dark-mode choice, if any. */
  viewerDark: boolean | null;
  /** prefers-color-scheme: dark */
  systemDark: boolean;
}
export interface Appearance {
  designSystem: DesignSystemName;
  dark: boolean;
}

/** Shape of src/browser/core/appearance.ts (pure). */
export interface AppearanceModule {
  /**
   * Viewer pick, else the page's, else DEFAULT_DESIGN_SYSTEM; unknown names
   * are ignored. Dark: the viewer's choice, else the system's.
   */
  resolveAppearance(input: AppearanceInput): Appearance;
  /** `${origin}/af/v1/design-systems/${name}.css` */
  designSystemHref(origin: string, name: DesignSystemName): string;
  /** The <html> attributes to set; `data-af-dark` is absent (not "false") in light mode. */
  htmlAttributes(appearance: Appearance): Record<string, string | null>;
  /** The import map JSON the core inserts: { imports: { "@afbin/apollo": url } }. */
  importMap(urls: { apollo: string }): { imports: Record<string, string> };
}
