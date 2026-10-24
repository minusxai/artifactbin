import { assertStorable } from './apollo/storable';
import type { OriginalFilePort, PortableDocument, PortableIdentity } from './portable-contract';

function identity(value: PortableIdentity): PortableIdentity {
 const url=new URL(value.platformOrigin);
 if(!(url.protocol==='https:' || url.protocol==='http:'&&['localhost','127.0.0.1','[::1]'].includes(url.hostname)) || url.origin!==value.platformOrigin || url.username || url.password) throw new Error('Invalid portable platform origin');
 if(!value.artifactId || !value.baseRevision || !/^[a-f0-9]{64}$/.test(value.sourceDigest)) throw new Error('Invalid portable identity');
 return {platformOrigin:url.origin,artifactId:value.artifactId,baseRevision:value.baseRevision,sourceDigest:value.sourceDigest,...(value.dependencyIdentity?{dependencyIdentity:{...value.dependencyIdentity}}:{})};
}
/** Explicit allowlist prevents transport/session fields leaking into downloaded files. */
export function portableScript(value: PortableDocument): string {
 if(value.version!==1 || typeof value.source!=='string') throw new Error('Invalid portable document');
 if(value.privateState) assertStorable(value.privateState);
 const safe:PortableDocument={version:1,source:value.source,...(value.renderedDigest?{renderedDigest:value.renderedDigest}:{}),...(value.identity?{identity:identity(value.identity)}:{}),...(value.privateState?{privateState:value.privateState}:{})};
 return `<script type="application/json" data-af="portable">${JSON.stringify(safe).replace(/</g,'\\u003c')}</script>`;
}
export function readPortableDocument(html: string): PortableDocument {
 const match=/<script\s+type="application\/json"\s+data-af="portable">([^<]*)<\/script>/.exec(html);
 if(!match) throw new Error('Canonical portable source is unavailable');
 const parsed=JSON.parse(match[1]!) as PortableDocument;
 return JSON.parse(portableScript(parsed).replace(/^<script[^>]*>/,'').replace(/<\/script>$/,'')) as PortableDocument;
}
/** Caller must obtain an explicit writable handle. No automatic disk persistence. */
export async function saveOriginal(port: OriginalFilePort, expected: string, source: string): Promise<void> {
 if(await port.read()!==expected) throw new Error('Original file changed; save a copy instead');
 await port.write(source);
}
