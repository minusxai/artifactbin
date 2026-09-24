/**
 * THE THEME STAMP — the inline script web/index.html runs before paint, and
 * the CSP hash that admits it. One copy, so every page that carries the stamp
 * (the SPA shell, a custom domain's home page) carries the same bytes under
 * the same hash; lib/__tests__/app-page-csp derives both from web/index.html,
 * so an edit to either side turns red instead of silently blocking the script.
 *
 * LIGHT is the default and carries no attribute; only a stored `mx_theme=dark`
 * (written by the app bar's toggle) stamps `data-theme="dark"`. The storage is
 * per origin.
 */
export const THEME_BOOTSTRAP_SCRIPT = "try{if(localStorage.getItem('mx_theme')==='dark')document.documentElement.dataset.theme='dark'}catch(e){}";
export const THEME_BOOTSTRAP_HASH = "'sha256-MKCvCRsPxrVldjRT7eukzwMMAlrlAXCz+AyDpcVL9Fg='";
