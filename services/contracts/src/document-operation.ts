/** Child-index paths address the caller's snapshot. They never address arbitrary
 * JSON object properties. A parent path of [] denotes the document root list. */
export type DocumentPath = readonly number[];
export type DocumentValue = null | boolean | number | string | DocumentValue[] | { [key: string]: DocumentValue };
/** A composite is an ordered array: each operation sees the preceding result.
 * Move indexes address the destination AFTER removing the moved node. */
export type DocumentOperation =
 | {kind:'setText';path:DocumentPath;value:string}
 | {kind:'setAttribute';path:DocumentPath;name:string;value:DocumentValue}
 | {kind:'removeAttribute';path:DocumentPath;name:string}
 | {kind:'insert';parent:DocumentPath;index:number;source:string}
 | {kind:'delete';path:DocumentPath}
 | {kind:'replace';path:DocumentPath;source:string}
 | {kind:'move';path:DocumentPath;parent:DocumentPath;index:number}
 | {kind:'replaceDocument';source:string};
export const MAX_DOCUMENT_OPERATIONS=64;
