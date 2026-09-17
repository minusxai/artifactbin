/** Keep file rendering and engines behind the packaged host boundary. */
import {createRequire} from 'node:module';
import {dirname,join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {isSea} from 'node:sea';
import {hostRuntime} from './host-runtime';
import {foregroundProcess} from './foreground-process';
import {PREVIEW_HOST_ARG} from './entry-args';
import type {PreviewOptions} from './preview-options';
export async function servePreview(options:PreviewOptions):Promise<number>{
 const assets=await hostRuntime(options.home);
 const prefix=isSea()?[]:[join(dirname(fileURLToPath(import.meta.url)),'afbin.mjs')];
 return foregroundProcess(process.execPath,[...prefix,PREVIEW_HOST_ARG,JSON.stringify(options),assets]);
}
export async function startPreviewRuntime(options:PreviewOptions,assets:string):Promise<void>{
 const bootstrap=join(assets,'bootstrap.cjs');
 const host=createRequire(bootstrap)(bootstrap) as {preview:(options:PreviewOptions,assets:string)=>Promise<void>};
 await host.preview(options,assets);
}
