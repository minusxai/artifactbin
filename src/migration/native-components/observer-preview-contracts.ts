/** Host-selected capability, bound by the author receipt to the exact captured script.
 * Only HTML from the named read query and the captured theme selection is previewed.
 * This adds no account/session access, query writes, or child-to-parent bridge.
 */
export interface NativeObserverPreviewPlan {
 sourceNodeId:string;
 resources:readonly {source:string;target:string;sha256:string}[];
}
