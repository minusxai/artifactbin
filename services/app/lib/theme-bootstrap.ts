/**
 * THE THEME STAMP — the inline script web/index.html runs before paint, and
 * the CSP hash that admits it. One copy, so every page that carries the stamp
 * (the SPA shell, a custom domain's home page) carries the same bytes under
 * the same hash; lib/__tests__/app-page-csp derives both from web/index.html,
 * so an edit to either side turns red instead of silently blocking the script.
 *
 * LIGHT carries no attribute. A stored `mx_theme` (written by the app bar's
 * toggle) is the reader's choice and wins; with none, the device's own
 * `prefers-color-scheme` decides, so a phone set to dark opens dark. The
 * storage is per origin.
 */
export const THEME_BOOTSTRAP_SCRIPT = "try{var t=localStorage.getItem('mx_theme');if(t==='dark'||(!t&&matchMedia('(prefers-color-scheme: dark)').matches))document.documentElement.dataset.theme='dark'}catch(e){}";
export const THEME_BOOTSTRAP_HASH = "'sha256-USz32hNL1w0XjC91sumHAazpgVdGMaVh0Kd6fWt0Dho='";
