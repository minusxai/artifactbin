import path from 'node:path';
/** Development-only Vite settings for the app's web root. */
export function developmentViteOptions(appRoot: string, port: number) {
  return { cacheDir: path.join(appRoot, 'node_modules/.vite', `dev-${port}`), optimizeDeps: { entries: ['main.tsx'] } };
}
