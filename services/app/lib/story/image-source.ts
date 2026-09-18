/** Image bindings resolve data, never executable expressions or unchecked URLs. */
import {ARTIFACT_REFERENCE_PATTERN} from '@artifactbin/contracts';
import {parseRowRef} from './row-scope';
import {resolveRefTemplate,type Scalar} from './dataflow';

export function boundImageValue(template:string,values:Record<string,Scalar>,row?:Record<string,unknown>):string|null {
 const field=parseRowRef(template);
 const value=field ? row?.[field] : resolveRefTemplate(template,name=>values[name]);
 return typeof value==='string' && value!=='' ? value : null;
}

/** Exact uploaded-image reference; malformed refs never become browser requests. */
export const imageReferenceId=(value:unknown):string|null=>typeof value==='string'&&value.startsWith('ref:') ? ARTIFACT_REFERENCE_PATTERN.exec(value)?.[1]??null : null;
