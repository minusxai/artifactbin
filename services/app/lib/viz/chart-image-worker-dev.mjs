/** Development-only entry of the query image's thread. Production starts the bundled
 * chart-image-worker.mjs beside the server; here tsx registers first so the source graph (and its
 * `@/` paths) loads through it rather than Node's native type stripping.
 */
import { register } from 'tsx/esm/api';
register();
await import('./chart-image-worker.ts');
