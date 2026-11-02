/** Image bindings resolve data, never executable expressions or unchecked URLs. */
import {ARTIFACT_REFERENCE_PATTERN} from '@artifactbin/contracts';
/** Exact uploaded-image reference; malformed refs never become browser requests. */
export const imageReferenceId=(value:unknown):string|null=>typeof value==='string'&&value.startsWith('ref:') ? ARTIFACT_REFERENCE_PATTERN.exec(value)?.[1]??null : null;
