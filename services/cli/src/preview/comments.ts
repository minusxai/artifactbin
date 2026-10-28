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

/** The person at this machine, as local comments name them: the browser preview's author, and the CLI's without --agent. */
export const LOCAL_AUTHOR_LABEL='You';
