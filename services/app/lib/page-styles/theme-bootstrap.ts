/**
 * THE THEME STAMP — the inline script web/solid-app.html runs before paint, and
 * the CSP hash that admits it. One copy, so every page that carries the stamp
 * (the SPA shell, a custom domain's home page) carries the same bytes under
 * the same hash; lib/__tests__/app-page-csp derives both from web/solid-app.html,
 * so an edit to either side turns red instead of silently blocking the script.
 *
 * LIGHT carries no attribute. A stored `mx_theme` (written by the app bar's
 * toggle) is the reader's choice and wins; with none, the device's own
 * `prefers-color-scheme` decides, so a phone set to dark opens dark. The
 * storage is per origin. A pick stored before the app also kept it in a cookie
 * (lib/story-runtime/reader-mode chooseTheme) is copied into one here, so the
 * app's server serves documents in it from the next load; the device's own
 * setting is never written: it is not a pick.
 */
export const THEME_BOOTSTRAP_SCRIPT = "try{var t=localStorage.getItem('mx_theme');if(t==='dark'||(!t&&matchMedia('(prefers-color-scheme: dark)').matches))document.documentElement.dataset.theme='dark';if((t==='dark'||t==='light')&&document.cookie.indexOf('mx_theme='+t)<0)document.cookie='mx_theme='+t+'; path=/; max-age=31536000; samesite=lax'}catch(e){}";
export const THEME_BOOTSTRAP_HASH = "'sha256-jlJ6FIrdMqLolm3SDh5HoFh36G4pAhJ2WxYewl4hAhI='";
