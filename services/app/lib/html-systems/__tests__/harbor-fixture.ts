/** A neutral installation design system for tests: "Harbor", teal on navy, one stub font of its own (fixtures/harbor). */
import {readFileSync,writeFileSync} from 'node:fs';
import path from 'node:path';
import {onTestFinished} from 'vitest';
import {tempDirSync} from '@artifactbin/test-support/temp-dir';

const FIXTURE=path.join(import.meta.dirname,'fixtures/harbor');
/** A WOFF2 signature and padding: what the boot checks of a font file. */
export const HARBOR_FONT=readFileSync(path.join(FIXTURE,'harbor-sans.woff2'));
export const harborSpec=()=>JSON.parse(readFileSync(path.join(FIXTURE,'system.json'),'utf8')) as Record<string,unknown>;
/** The same system without dark values: light-only. */
export const lightOnly=()=>{const spec=harborSpec();spec.tokens=(spec.tokens as Array<Record<string,string>>).map(({dark:_dark,...rest})=>rest);return spec;};
/** A directory holding `spec` as system.json and the files given (the Harbor font by default). */
export function harborDir(spec:unknown=harborSpec(),files:Record<string,string|Buffer>={'harbor-sans.woff2':HARBOR_FONT}):string{
 const root=tempDirSync('design-system-',onTestFinished);
 writeFileSync(path.join(root,'system.json'),JSON.stringify(spec));
 for(const [name,content] of Object.entries(files))writeFileSync(path.join(root,name),content);
 return root;
}
