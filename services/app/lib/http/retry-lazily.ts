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
 const {retryFetch}=await import('./retry');
 return retryFetch(send,{...options,first});
}
