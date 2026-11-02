/** Native image reference projection. The caller owns current read authorization. */
export interface ImageRefData {kind:'image';url:string;width?:number;height?:number;smallUrl?:string;smallWidth?:number;blur?:string}
export function imageRefData(row:{id:string;version:number;meta:unknown},capture=false):ImageRefData {
  const im=row.meta as {width?:unknown;height?:unknown;placeholder?:unknown;smallObjectKey?:unknown;smallWidth?:unknown}|null;
  return {kind:'image',url:rawUrl(row.id,row.version),
    ...(typeof im?.width==='number'&&typeof im?.height==='number'?{width:im.width,height:im.height}:{}),
    ...(typeof im?.placeholder==='string'&&im.placeholder.startsWith('data:')?{blur:im.placeholder}:{}),
    ...(!capture&&typeof im?.smallWidth==='number'&&typeof im?.smallObjectKey==='string'?{smallUrl:imageVariantUrl(row.id,row.version,im.smallWidth),smallWidth:im.smallWidth}:{}),
  };
}

/**
 * Where an uploaded artifact's BYTES live (an image, a PDF, a file) — the one place this shape is
 * written. `/raw` is the bytes; `/a/<id>` is the HTML page, which an <img> loads to 0×0 and a link
 * opens as a page. `?v=<version>` changes when the bytes do, which is what lets /raw serve them
 * immutable. The render-time ref map (refDataForRow), a <File> card's link and the create echo the
 * editor inserts from all call this, so a freshly created artifact and one rendered from storage can
 * never point at different addresses.
 */
export const rawUrl = (id: string, version: number): string => `/a/${id}/raw?v=${version}`;

/** Where the narrow copy of the same image artifact lives: the same bytes, `?w=` apart. */
const imageVariantUrl = (id: string, version: number, width: number): string =>
  `${rawUrl(id, version)}&w=${width}`;
