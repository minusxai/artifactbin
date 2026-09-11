/** Protect personal credentials even when an older installation left files behind. */
import {existsSync} from 'node:fs';
import {join} from 'node:path';
export function privateConnectionPaths(home:string):string[]{
 return ['.artifactbin','.artifactbin.env','.config/artifact-bin'].map(relative=>join(home,relative)).filter(existsSync);
}
