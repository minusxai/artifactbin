/** Development-only entry. Production selects the bundled pool-worker.mjs.
 * The dynamic import must follow registration so the source dependency graph
 * uses tsx rather than Node's native stripping and extension resolution.
 */
import { register } from 'tsx/esm/api';
register();
await import('./pool-worker.ts');
