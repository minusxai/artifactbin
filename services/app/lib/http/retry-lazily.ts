import type {RetryOptions,RetryResult,SendContext} from './retry';

/** ./retry's retryable statuses, restated so the policy module loads only after a first attempt failed. */
const RETRYABLE=new Set([502,503,504]);

/**
 * ./retry's `retryFetch`, with the policy fetched only when needed: the first attempt is sent here, and nearly every
 * request ends with it. Browser code that runs before a document frame is ready uses this, so the app shell carries a
 * few lines rather than the policy (the page-speed size budget). Same results, same attempt numbering.
 */
export async function retryLazily(send:(context:SendContext)=>Promise<Response>,options:Omit<RetryOptions,'first'>={}):Promise<RetryResult>{
 const started=Date.now();
 let first:NonNullable<RetryOptions['first']>;
 try{first={response:await send({attempt:1,idempotencyKey:options.idempotencyKey}),started};}catch(failure){first={failure,started};}
 if(first.response&&!RETRYABLE.has(first.response.status))return {response:first.response,attempts:1};
 // An abort is the caller's decision (as in ./retry): surfaced at once, without loading the policy to say so.
 if(first.failure!==undefined&&options.signal?.aborted){const failure=first.failure;if(failure&&typeof failure==='object')try{(failure as {attempts?:number}).attempts=1;}catch{/* frozen */}throw failure;}
 const {retryFetch}=await import('./retry');
 return retryFetch(send,{...options,first});
}

/**
 * `fetch(url, init)` through the shared policy, for the app's own reads: a GET or HEAD rides out a deploy restart;
 * any other method is sent once (./retry repeats only what cannot double-apply). `init.signal` aborts the waits too.
 * Resolves to the final Response, rejects with the final error, exactly as fetch would. `fetch` is looked up per call.
 */
export async function retryingFetch(url:string,init:RequestInit={}):Promise<Response>{
 return (await retryLazily(()=>fetch(url,init),{method:init.method??'GET',signal:init.signal??undefined})).response;
}
