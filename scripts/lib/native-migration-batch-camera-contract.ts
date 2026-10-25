import type {NativeMigrationPilotInput,NativeMigrationPilotPaths} from './native-migration-pilot-contract';
/** One implementation, one actual batch-imported DB/object snapshot, one gate/browser. */
export interface NativeMigrationCaptureBatch {
 format:'native-migration-capture-batch-v1';revisionScope:'latest';implementation:'jsx'|'html';
 /** All paths relative to the private read-only batch root except output (relative to private output root). */
 entries:readonly {input:{path:string;sha256:string};canonical:{path:string;sha256:string};recovery:{path:string;sha256:string};bundle:string;output:string;mutableDatasetIds:readonly string[];mutationReset?:{path:string;sha256:string}}[];
 sha256:string;
}
export interface NativeMigrationAdmittedCaptureBatch {
 manifest:NativeMigrationCaptureBatch;storeContentSha256:string;
 entries:readonly {input:NativeMigrationPilotInput;paths:NativeMigrationPilotPaths;mutationResetPath?:string}[];
}
export interface NativeMigrationBatchCapturePorts {
 browser:unknown;connectAgent:Function;base:string;
 /** Existing real pilot runner; injection is only for focused lifecycle tests. */
 capture?:(options:{base:string;paths:NativeMigrationPilotPaths;browser:unknown;connectAgent:Function})=>Promise<unknown>;
 state?:{read(context:unknown):Promise<Readonly<Record<string,unknown>>>;restore(context:unknown,before:Readonly<Record<string,unknown>>):Promise<void>};
 now?:()=>number;
}
