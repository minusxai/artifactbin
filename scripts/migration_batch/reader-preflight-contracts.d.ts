export interface ReaderExpectedPins {version:number;assembly:string;comparison:string;decision?:string}
export type ReaderPreflightPhase='before-apply'|'after-apply-before-reader-db';
export interface ReaderPreflightOptions {configPath:string;id:string;scopeModule:string;digestModule:string;phase:ReaderPreflightPhase}
export interface ReaderPreflightResult {format:'migration-reader-binding-preflight-v1';phase:ReaderPreflightPhase;expected:ReaderExpectedPins;receiptChecksPendingAfterApply:boolean;actualReadbackScopeExecuted:boolean;dbOpened:false;tokenMinted:false;productionWrites:0}
