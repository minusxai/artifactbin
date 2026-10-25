import type {Db} from '../../services/app/lib/platform/db';
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
 captureAndCompare:NativeMigrationBootstrapOptions['captureAndCompare'];
 dispose():Promise<void>;
}
