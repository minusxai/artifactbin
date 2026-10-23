/**
 * THE CLI'S CONTRACT WITH THE APP, PART 2: what the CLI's packaged host runtimes use — the local
 * preview and export host (`src/preview-entry.ts`, dist/runtime/preview.mjs) and the team host
 * (`src/team-application.ts`, dist/runtime/host.mjs). Node only.
 *
 * The local render pipeline and server wiring live here, never in `./index`: they import Babel,
 * Tailwind, sharp and the server configuration, which the `afbin` process bundle must not carry
 * (services/cli/src/host-runtime.ts loads these hosts as separate files for that reason).
 */

// ---- Team host: server configuration, services and accounts the team application composes.
export { EVENTS_SCHEMA, MAX_QUERY_ROWS, QUERY_TIMEOUT_MS } from '../platform/config';
export { setServices } from '../platform/services';
export type { Db } from '../platform/db';
export { canAuthenticateUser } from '../accounts';

export {admitDeploymentIdentity,validateDeploymentConfiguration} from '../deployment';
