import {rmSync} from 'node:fs';
import path from 'node:path';
/** Exact retired platform output only; never infer ownership from a filename. */
export function removeRetiredLibraryOutput(outputRoot) {
  rmSync(path.join(outputRoot,'mermaid-12.0.0'),{recursive:true,force:true});
}
