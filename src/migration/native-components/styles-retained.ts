import {readFile} from 'node:fs/promises';
import path from 'node:path';
import {promisify} from 'node:util';
import {execFile} from 'node:child_process';
import {externalCompile} from '../conversion/compiled/index.ts';
import {resourceSha256} from './resources.ts';
import type {NativeStyleSnapshot} from './styles.ts';
export const NATIVE_STYLE_PRODUCT_PIN='8eaac63810b66eb575b018be89bb63443e1b7aaf';
const files=['services/app/lib/page-styles/document-styles.ts','services/app/lib/page-styles/chrome-css.ts','services/app/lib/page-styles/document-fonts.ts','services/app/lib/page-styles/document-root.ts','services/app/lib/page-styles/story-base-css.ts','services/app/lib/data/story/story-fonts.ts','services/app/lib/data/story/story-themes.ts','services/app/lib/data/story/story-system-sheets.ts','services/app/lib/data/story/story-system-sheets.json','services/app/lib/document/document-graph.ts','services/app/lib/document/helmet.ts','services/app/lib/story-ui/interpreter-primitives.ts','services/app/lib/compiled-page/static-solid/attrs.ts','services/app/lib/story-surface/bare-typography.ts','services/app/lib/story-surface/bare-controls.ts','services/app/lib/story-surface/task-checkbox-css.ts','services/app/lib/story-surface/index.ts','services/app/lib/story-runtime/contract.ts','services/app/lib/dataflow/ref-data.ts','package-lock.json'];
export async function nativeStyleCompilerProof(root:string):Promise<{compilerSha256:string;sourceFiles:{path:string;sha256:string}[]}>{
 const sourceFiles=[];for(const file of files){const [actual,original]=await Promise.all([readFile(path.join(root,file)),promisify(execFile)('git',['show',`${NATIVE_STYLE_PRODUCT_PIN}:${file}`],{cwd:root,encoding:'buffer',maxBuffer:16*1024*1024})]);const sha256=resourceSha256(actual);if(sha256!==resourceSha256(original.stdout))throw Error('Retained style source pin changed');sourceFiles.push({path:file,sha256});}
 const manifest=await readFile(path.join(root,'services/app/lib/data/story/story-font-manifest.json'));sourceFiles.push({path:'generated/story-font-manifest.json',sha256:resourceSha256(manifest)});
 return {compilerSha256:resourceSha256(JSON.stringify(sourceFiles)),sourceFiles};
}
export interface NativeRetainedStyleInput {document:unknown;sourceSha256:string;analysisSha256:string;compiledCss:string;theme:string|null;colorMode:'light'|'dark'|null;refRows?:readonly Record<string,unknown>[]}
export async function extractNativeStyleSnapshot(input:NativeRetainedStyleInput,legacyRoot:string,proof:Awaited<ReturnType<typeof nativeStyleCompilerProof>>):Promise<NativeStyleSnapshot>{
 const result=await externalCompile<Pick<NativeStyleSnapshot,'sheets'|'htmlAttributes'|'storyAttributes'|'inlineStyles'|'presentationUrls'|'resourcePatches'>,NativeRetainedStyleInput>(input,{legacyRoot},'../../native-components/styles-runner.mts');
 return {...result,...proof,sourceSha256:input.sourceSha256,analysisSha256:input.analysisSha256};
}
