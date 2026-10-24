import type {BrowserParityFixture} from '../fixtures/component-baseline/contract';
/** Private external input only. Never commit canonical source, selectors, IDs or screenshots. */
export interface NativeMigrationPilotInput {
 format:'native-migration-pilot-v1';
 implementation:'jsx'|'html';
 preparedStore?:NativePreparedPilotStore;
 /** Standalone private harness module, never page code. Bound in bundleFiles. */
 probe?:{path:string;sha256:string};
 harnessSha256:string;
 /** Product-owned gate inventory may differ; verify and report its exact bytes per run. */
 gateManifestSha256:string;
 originalRevision:string;
 candidateRevision:string;
 canonicalSha256:string;
 recoverySha256:string;
 key:{sourceNamespace:string;sourceId:string;version:number};
 rowSha256:string;
 documentSha256:string;
 sourceSha256:string;
 bundleFiles:readonly {path:string;sha256:string}[];
 theme:'light'|'dark';
 viewports:readonly {width:number;height:number}[];
 states:BrowserParityFixture['states'];
}
export interface NativeMigrationPilotPaths {
 input:string;canonical:string;recovery:string;bundle:string;output:string;
}

/** Private actual-import store, prepared offline and copied into one gate's disposable scratch. */
export interface NativePreparedPilotStore {
 format:'native-prepared-store-v1';
 directory:'prepared-store';
 fixtureAuthSecret?:{path:'fixture-auth-secret';sha256:string;bytes:number;provenance:'disposable-target-test-key'};
 directories:readonly string[];
 files:readonly {path:string;sha256:string;bytes:number}[];
 reader:{pageId:string;version:number;accountEmail:string;datasetIds:readonly string[];identityPlanSha256:string};
 sha256:string;
}

export interface NativeImportedPilotProbe {
 mountImportedPilot(context:{page:unknown;frame:unknown;state:NativeMigrationPilotInput['states'][number];viewport:{width:number;height:number};regression:boolean;server:string;reader:NativePreparedPilotStore['reader'];output:string;authenticate:(email:string,page?:unknown)=>Promise<void>}):Promise<{ready?:()=>Promise<void>;performAction?:(action:unknown)=>Promise<void>;afterAction?:(action:unknown)=>Promise<void>}>;
}
