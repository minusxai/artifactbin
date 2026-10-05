/** Legacy entry points are inert: npm owns package installation; afbin never replaces itself. */
import {BACKGROUND_UPDATE_ARG} from './entry-args';
export {BACKGROUND_UPDATE_ARG};
export const UPDATE_CHECK_MS=60*60*1000;
export const UPDATE_RETRY_MS=UPDATE_CHECK_MS;
export interface BackgroundOptions {
 platform?:string;home:string;server:string;launchId?:string;env?:NodeJS.ProcessEnv;standalone?:boolean;executable?:string;now?:()=>number;
 launch?:(executable:string,args:string[],env:NodeJS.ProcessEnv)=>void;update?:()=>Promise<unknown>;
}
export async function scheduleBackgroundUpdate(_options:BackgroundOptions):Promise<void>{}
export async function runBackgroundUpdate(_options:BackgroundOptions):Promise<void>{}
export async function backgroundUpdateMain(_args:string[],_options:Pick<BackgroundOptions,'standalone'|'update'>&{deadlineMs?:number}={}):Promise<void>{}
