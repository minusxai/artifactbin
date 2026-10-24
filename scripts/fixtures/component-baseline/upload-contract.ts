import type {BrowserParityFixture} from './contract';
type UploadScenario='success'|'remove'|'lost-response-retry'|'invalid-type'|'invalid-size'|'server-invalid-type'|'permission';
/** The real HTTP response/readback is required independently of the rendered component state. */
export interface UploadParityFixture extends BrowserParityFixture {uploadScenario:UploadScenario}
export interface UploadBackendProof {fixture:string;theme:string;viewport:number;requests:number;statuses:number[];requestIds:string[];refs:string[];readbackSha256?:string;replayed?:boolean}
/** Observation, not an assertion that implementations already match signed-out UX. */
export interface UploadSignedOutProof {theme:string;viewport:number;inputDisabled:boolean;inputHidden:boolean;buttonDisabled:boolean;text:string;requests:number;statuses:number[];requestIds:string[];refs:string[]}
