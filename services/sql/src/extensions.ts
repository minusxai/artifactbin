import type {DuckDBConnection} from '@duckdb/node-api';
import type {MutationInput,QueryFailure} from '@artifactbin/contracts';
/** Installed by a trusted composition root; query authors cannot install executable hooks. */
export interface SqlExtensions {
 setupMutation?:(connection:DuckDBConnection,native:typeof import('@duckdb/node-api'),context:{input?:MutationInput;dryRun:boolean})=>(()=>QueryFailure['continuation'])|void;
}
