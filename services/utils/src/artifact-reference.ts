import {ARTIFACT_SEGMENT_PATTERN} from '@artifactbin/contracts';

export function artifactIdFromSegment(segment:string):string|null{
 return ARTIFACT_SEGMENT_PATTERN.exec(segment)?.[1]??null;
}

/** Canonical path shapes only. Username/title decoration never participates in identity. */
export function artifactIdFromPath(pathname:string):string|null{
 const match=/^\/(?:a|@[^/]+)\/([^/]+)\/?$/.exec(pathname);
 if(!match)return null;
 const segment=match[1];if(segment===undefined)return null;
 try{return artifactIdFromSegment(decodeURIComponent(segment));}catch{return null;}
}
