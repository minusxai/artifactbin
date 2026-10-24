import type {BrowserParityFixture} from '../fixtures/component-baseline/contract';
/** Private external input only. Never commit canonical source, selectors, IDs or screenshots. */
export interface NativeMigrationPilotInput {
 format:'native-migration-pilot-v1';
 implementation:'jsx'|'html';
 harnessSha256:string;
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
