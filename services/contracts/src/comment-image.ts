/** Bounds shared by capture, brush rendering, upload and persistence. */
import {DEFAULT_UPLOAD_MAX_BYTES} from './upload-limits';
export const COMMENT_IMAGE_LIMITS = {edge:2048,pixels:4000000,bytes:DEFAULT_UPLOAD_MAX_BYTES,thumbnail:480,strokes:500,points:50000,stageHours:24} as const;
export interface BrushStroke {color:string;width:number;points:Array<[number,number]>}
export interface CommentImageMetadata {
 v:1; capturedEditId:string; capturedAt:string; method:'region'|'canvas'|'upload';
 width:number;height:number;
 rect:{x:number;y:number;width:number;height:number};
 viewport:{width:number;height:number};
 strokes:BrushStroke[];
}
export interface CommentImageWire {
 id:string; width:number;height:number; capturedEditId:string; capturedAt:string;
 originalUrl:string;previewUrl:string;thumbnailUrl:string;
}
