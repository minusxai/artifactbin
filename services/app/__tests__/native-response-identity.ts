/** Test identity of native responses: retain every byte except the platform's per-render nonce. */
export interface NativeResponseIdentity { nonce:string; html:string }
export function nativeResponseIdentity(html:string):NativeResponseIdentity {
 const coreTags=html.match(/<script\b[^>]*\bdata-af="core"[^>]*>/g)??[];
 const policyTags=html.match(/<meta\b[^>]*\bdata-af="script-policy"[^>]*>/g)??[];
 if(coreTags.length!==1||policyTags.length!==1)throw Error('Expected one platform core and script policy');
 const core=coreTags[0]!,policy=policyTags[0]!,nonce=/\bnonce="([a-f0-9]{32})"/.exec(core)?.[1];
 if(!nonce||!policy.includes("'nonce-"+nonce+"'"))throw Error('Platform nonce must match its CSP admission');
 return {nonce,html:html.replace(core,core.replace(`nonce="${nonce}"`,'nonce="PLATFORM_NONCE"')).replace(policy,policy.replace("'nonce-"+nonce+"'","'nonce-PLATFORM_NONCE'"))};
}
