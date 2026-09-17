import {ARTIFACT_SEGMENT_PATTERN} from '@artifactbin/contracts';

/** `/a/<segment>` or `/@<username>/<segment>`; group 1 is the segment, group 2 whatever follows it. */
const ARTIFACT_PATH_PATTERN=/^\/(?:a|@[^/]+)\/([^/]+)(\/.*)?$/;

export function artifactIdFromSegment(segment:string):string|null{
 return ARTIFACT_SEGMENT_PATTERN.exec(segment)?.[1]??null;
}

function artifactIdFrom(pathname:string,trailing:boolean):string|null{
 const match=ARTIFACT_PATH_PATTERN.exec(pathname);
 if(!match)return null;
 const segment=match[1];if(segment===undefined)return null;
 const rest=match[2];
 if(!trailing&&rest!==undefined&&rest!=='/')return null;
 try{return artifactIdFromSegment(decodeURIComponent(segment));}catch{return null;}
}

/** Canonical path shapes only. Username/title decoration never participates in identity. */
export function artifactIdFromPath(pathname:string):string|null{
 return artifactIdFrom(pathname,false);
}

/**
 * The same grammar where the artifact's own address is only a PREFIX — `/a/<id>/edit`,
 * `/@owner/<id>-<slug>/edit`. For callers that observe whatever page a browser is on
 * rather than resolving a reference the user typed.
 */
export function artifactIdFromPathPrefix(pathname:string):string|null{
 return artifactIdFrom(pathname,true);
}
