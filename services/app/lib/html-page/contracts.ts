/** Persist the allocation ledger with the page head; removed IDs remain reserved forever. */
export interface HtmlIdentityLedger { readonly allocatedIds: readonly string[]; readonly nextNodeId: number }
/** `carry` reports, for a publish over a previous version, how many missing IDs were carried forward vs freshly minted. */
export interface CanonicalHtmlPage { html: string; ledger: HtmlIdentityLedger; nodeIds: readonly string[]; carry?: { carried: number; fresh: number } }
export interface CanonicalHtmlOptions { previousHtml?: string; ledger?: HtmlIdentityLedger }
/** Metadata authored in the document head, overridden only by explicit API fields. */
export interface HtmlPageMetadata {title:string|null;description:string|null}
/** Install presentation is authored in native head meta; app identity and scope remain platform-owned. */
export interface HtmlPwaSettings {enabled?:boolean;name?:string;shortName?:string;icon?:string;themeColor?:string;backgroundColor?:string}
export interface HtmlAssetLinks {refs:string[];imageUrls:string[]}
