import type {NativeHostFile} from './native-migration-host-contract';
/** Private mode-0600 configuration. Secret environment values live only in the referenced file. */
export interface NativeProductionCliConfiguration {
 format:'native-production-cli-v1';
 runtimeOrigin:string;
 runtimeEnvironment:NativeHostFile;
 planPath:string;batchPath:string;receiptRoot:string;outputDirectory:string;
 publication:{module:NativeHostFile;configuration:NativeHostFile};
 contextCodec?:NativeHostFile;
 sha256:string;
}
