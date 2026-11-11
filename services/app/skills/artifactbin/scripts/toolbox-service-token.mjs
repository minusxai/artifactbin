/**
 * Internal: a short-lived bearer for a service this origin issues tokens for (an id its
 * IDENTITY__SERVICE_AUDIENCES names), exchanged from the ONE saved grant through
 * POST /api/authentication/service-token, so no second sign-in or stored grant is needed.
 * Kept in memory only, reused until 30 s before it expires, never written or printed.
 * Used by: scripts that call such a service; author-toolbox tests.
 */
const held=new Map();
/** @param {{server:string,request:Function}} client makeClient's @param {string} audience */
export async function serviceToken(client,audience){
 const key=client.server+'\n'+audience,kept=held.get(key);
 if(kept&&kept.expiresAt>Date.now()+30000)return kept.token;
 const body=await client.request('/api/authentication/service-token',{method:'POST',
  body:{audience},safeToRepeat:true});
 const token={token:body.access_token,expiresAt:Date.parse(body.expires_at)};
 held.set(key,token);
 return token.token;
}
