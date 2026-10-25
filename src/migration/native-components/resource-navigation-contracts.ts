export interface NativeNavigationPage {sourceId:string;targetId:string;importReceiptSha256:string}
/** Only individually imported destinations may replace original application links. */
export interface NativeNavigationPolicy {sourceOrigin:string;identityPlanSha256:string;pages:readonly NativeNavigationPage[];sha256:string}
export interface NativeNavigationImport {sourceId:string;targetId:string;receiptBytes:Uint8Array;receiptSha256:string}
export interface NativeNavigationPreparation {sourceOrigin:string;identityPlan:Record<string,unknown>&{artifactIds:Record<string,string>};approvedPlanSha256:string;imports:readonly NativeNavigationImport[]}
