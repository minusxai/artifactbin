import type { Db } from '../../services/app/lib/platform';
import type {NativeMigrationBootstrapOptions} from './native-migration-bootstrap-contract';
export interface NativeDisposableFile {path:string;sha256:string}
/** All paths are reviewed references beneath the request receipt root. */
export interface NativeDisposableLifecycleConfiguration {
 format:'native-disposable-lifecycle-v1';
 origin:string;
 fixture:
  |{kind:'reviewed-target-identities';identity:NativeDisposableFile;schemas:{appSchema:string;authSchema:string}}
  |{kind:'prepared-store';input:NativeDisposableFile;bundle:string};
 camera:
  |{kind:'disabled'}
  |{kind:'gate-container';original:{root:string;revision:string};cpus:4;memory:'8g'};
 runtimeAuthority?:{mode:"disposable-scoped-tokens";ttlMs:number};
 maxFileBytes?:number;
 sha256:string;
}
export interface NativeDisposableAdapterConfiguration {
 targetRoot:string;targetRevision:string;lifecycleConfiguration?:NativeDisposableFile;
}
export interface NativeDisposableRequest {receiptRoot:string;output:string;stage:'assemble'|'import'|'capture'}
export interface NativeDisposableContext {outputDirectory:string;receiptRoot:string}
/** One process per selected key; application configuration is immutable after its first import. */
export interface NativeDisposableLifecycle {
 db:Db;objectsDirectory:string;fixtureAuthSecret:string;
 runtimeActors?:import("./native-migration-disposable-actors-contract").NativeDisposableRuntimeActorPort;
 captureAndCompare:NativeMigrationBootstrapOptions['captureAndCompare'];
 dispose():Promise<void>;
}

/** Original evidence is immutable; the new candidate reference is bound after the actual import snapshot exists. */
export type NativeDisposableSourceReuse=Omit<import('./native-migration-reuse-contract').NativeSourceCaptureReuse,'candidateInputPath'|'candidateInputSha256'>&{candidateInputPath?:string;candidateInputSha256?:string};
export interface NativeDisposableCameraPorts {
 read(file:string):Promise<Uint8Array>;
 resolve(file:string):Promise<string>;
 output(directory:string):Promise<void>;
 run(input:{root:string;revision:string;paths:{input:string;canonical:string;recovery:string;bundle:string;output:string};logPath:string}):Promise<void>;
 preflightReuse(input:{baselineDirectory:string;reuse:import('./native-migration-reuse-contract').NativeSourceCaptureReuse}):Promise<unknown>;
 compare(input:{baselineDirectory:string;candidateDirectory:string;output:string}):Promise<{passed:boolean}>;
 compareReuse(input:{baselineDirectory:string;candidateDirectory:string;output:string;reuse:import('./native-migration-reuse-contract').NativeSourceCaptureReuse}):Promise<{passed:boolean}>;
}
