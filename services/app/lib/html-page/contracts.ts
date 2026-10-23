/** Persist the allocation ledger with the page head; removed IDs remain reserved forever. */
export interface HtmlIdentityLedger { readonly allocatedIds: readonly string[]; readonly nextNodeId: number }
export interface CanonicalHtmlPage { html: string; ledger: HtmlIdentityLedger; nodeIds: readonly string[] }
export interface CanonicalHtmlOptions { previousHtml?: string; ledger?: HtmlIdentityLedger }
