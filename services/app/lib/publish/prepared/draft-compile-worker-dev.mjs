/** Development-only entry (as services/sql/src/pool-worker-dev.mjs): production starts the bundled draft-compile-worker.mjs. */
import { register } from 'tsx/esm/api';
register();
await import('./draft-compile-worker.ts');
