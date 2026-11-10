import type {MutationInput,QueryFailure} from '@artifactbin/contracts';
import type {SqliteDatabase} from './sqlite/database';
/**
 * Installed by a trusted composition root; query authors cannot install
 * executable hooks. Engine-neutral in shape: the hook receives the mutation's
 * own throwaway database (the engine's guarded `SqliteDatabase`) before the
 * statement is prepared — to register functions under names only it knows
 * (`internalFunction`), never to attach or load anything an author could read.
 * It may return a function the engine calls after the statement ran: a
 * continuation it answers makes the write a `QueryFailure` carrying it, and
 * nothing is persisted.
 *
 * A dry run should stub such a function (return NULL); reads are unaffected. Write-mode analysis installs the hook
 * as a dry run before preparing, so a mutation's analysis sees the functions its run will. In a server the hook
 * is a module whose default export every engine thread imports (`createSql(caps, { extensions: <module URL> })`);
 * the app host takes the same absolute specifier (`AppHostOptions.sqlExtensions`) for its own analysis. Downstream
 * code owns the authorization and validation of what it installs; this repository installs no external effects.
 */
export interface SqlExtensions {
 setupMutation?:(database:SqliteDatabase,context:{input?:MutationInput;dryRun:boolean})=>(()=>QueryFailure['continuation'])|void;
}
