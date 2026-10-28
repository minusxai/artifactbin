import type { HtmlNodeAnchor } from '@artifactbin/contracts';
/** Explicit native coordinates: API tests name the saved HTML identity and observed revision. */
export function nativeAnchor(nodeId:string,revision:number|string=1,quote=''):HtmlNodeAnchor {
 return {kind:'html-node',v:1,nodeId,revision:String(revision),quote};
}
