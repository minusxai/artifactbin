/** Local comments retain the same durable node and selection range as hosted annotations. */
import type {AnnotationRange} from '../../../app/lib/cli-toolkit';

export interface PreviewComment {
 id:string;
 file:string;
 node:string;
 name:string;
 text:string;
 quote?:string;
 range?:AnnotationRange|null;
}
