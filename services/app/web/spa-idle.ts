/**
 * THE ENTRY THE COMPILED READER PAGE LOADS (the assembler tags its script `data-mx-spa-idle`;
 * docs/phase2-architecture.md §2.2, §7.1). Tiny on purpose: it stamps the app's saved theme and
 * waits — idle for a writer, intent for everyone else (web/idle-boot) — before the app (web/main)
 * is fetched at all. The app then adopts the live island document (web/initial-story,
 * components/IslandStory) instead of drawing the page again.
 */
// The dev server's React refresh preamble, which web/index.html gets from Vite and this page does
// not (it is the server's HTML): empty in a build, so a production page carries none of it.
import '@vitejs/plugin-react/preamble';
import stylesheet from './shell.css?url';
import { startSpaIdle } from './idle-boot';
import { restoreReloadedReader } from './restore-reader';

restoreReloadedReader();
startSpaIdle({ load: () => import('./main'), stylesheet });
