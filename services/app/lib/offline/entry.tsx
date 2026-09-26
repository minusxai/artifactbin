/**
 * The offline bundle's entry — built as an IIFE by scripts/build-offline.mjs,
 * stored gzip+base64 in a downloaded file's `#afbin-code`, and run by the
 * file's boot script as inline script text (lib/offline/file-html).
 *
 * Two globals the build leaves for this file to fill, both before anything
 * renders:
 *  - the app's own stylesheet (`__AFBIN_APP_CSS__`, compiled at build time
 *    from app/globals.css): in the document, as the SPA has it, so tooltips and
 *    popovers portalled to <body> look like the site; and as the trusted
 *    chrome's sheet, exactly as web/main.tsx configures it;
 *  - the module URL (`import.meta.url` is empty in an IIFE, so the build maps
 *    it to `globalThis.__AFBIN_MODULE_URL__`): the file's own `origin`, the one
 *    app this document belongs to.
 */
import { configureTrustedUiStyles } from '@/components/TrustedUi';
import { mountOfflineFile } from './mount';

declare const __AFBIN_APP_CSS__: string;
declare global { var __AFBIN_MODULE_URL__: string | undefined; }

const style = document.createElement('style');
style.setAttribute('data-afbin-app', '');
style.textContent = __AFBIN_APP_CSS__;
document.head.append(style);
configureTrustedUiStyles(__AFBIN_APP_CSS__);

mountOfflineFile(document, (file) => {
  try { globalThis.__AFBIN_MODULE_URL__ = new URL('/story/offline.js', file.origin).href; } catch { /* a bad origin only matters to code that never runs offline */ }
});
