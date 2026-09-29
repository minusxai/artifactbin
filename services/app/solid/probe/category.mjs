/** What a bundled module is, for the grouped probe build and for the measurement (one definition). */
export function category(id) {
  if (/node_modules\/(react-router|cookie|set-cookie-parser|@solidjs\/router)\//.test(id)) return 'router';
  if (/node_modules\/(react|react-dom|scheduler|solid-js)\//.test(id)) return 'framework';
  if (/node_modules\/lucide-(react|solid)\//.test(id)) return 'icons';
  if (/node_modules\/(@radix-ui|@floating-ui|aria-hidden|react-remove-scroll|react-remove-scroll-bar|react-style-singleton|use-callback-ref|use-sidecar|get-nonce|tslib|clsx)\//.test(id)
    || /services\/app\/(components|solid\/components)\//.test(id) || /lib\/islands\/(kit\/popper|trusted-portal)/.test(id)) return 'components';
  if (/services\/app\/(web\/(session|use-page-data|page-data-store|page-data-events|navigation-preload-context|NavigationBoundary)|lib\/navigation|solid\/(web|shared)\/)/.test(id)) return 'data';
  if (/pages\/(Trash|NotFound)\.tsx$/.test(id)) return 'route';
  return 'other';
}
export const GROUPS = ['framework', 'router', 'icons', 'components', 'data'];
