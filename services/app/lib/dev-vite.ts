import path from 'node:path';
import type { ProxyOptions } from 'vite';
import { SHOWCASE, SHOWCASE_ORIGIN } from './showcase';
/** Development-only Vite settings for the app's web root. */
export function developmentViteOptions(appRoot: string, port: number) {
  return { cacheDir: path.join(appRoot, 'node_modules/.vite', `dev-${port}`), optimizeDeps: { entries: ['main.tsx'] } };
}

/** Local WebGL needs same-origin bytes. Only Vite installs this proxy; it
 * accepts curated export paths and never forwards local viewer credentials. */
export function developmentShowcaseProxy(): Record<string, ProxyOptions> {
  return {
    [`^/__dev/showcase/a/(${SHOWCASE.map(doc => doc.id).join('|')})/export(?:\\?|$)`]: {
      target: SHOWCASE_ORIGIN,
      changeOrigin: true,
      rewrite: url => url.replace('/__dev/showcase', ''),
      configure: proxy => {
        proxy.on('proxyReq', request => {
          request.removeHeader('cookie');
          request.removeHeader('authorization');
        });
      },
    },
  };
}
