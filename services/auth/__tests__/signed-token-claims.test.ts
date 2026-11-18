/**
 * The two signed token kinds (exchanged service tokens, `vwt_`, and artifact read grants, `arg_`) share one format and
 * one claims check: every malformed token below, correctly signed, is refused by both, and the well-formed one is
 * accepted by both, so the two validators cannot drift apart.
 */
import {createHmac} from 'node:crypto';
import {describe,expect,it} from 'vitest';
import {SERVICE_TOKEN_TTL_SECONDS} from '@artifactbin/contracts';
import {artifactReadKey,signArtifactReadGrant,verifyArtifactReadGrant} from '../src/identity/artifact-read-grants';
import {serviceTokenKey,signServiceToken,verifyServiceToken} from '../src/identity/service-tokens';

const SERVICE={id:'warehouse',origin:'https://warehouse.example',introspectionSecretSha256:null};
const NOW=Date.UTC(2026,10,18,12),NOW_S=NOW/1000;
const KINDS=[
 {name:'service token',prefix:'vwt_',ttl:SERVICE_TOKEN_TTL_SECONDS,key:serviceTokenKey('host-secret'),sign:signServiceToken,verify:verifyServiceToken},
 {name:'artifact read grant',prefix:'arg_',ttl:3600,key:artifactReadKey('host-secret'),sign:signArtifactReadGrant,verify:verifyArtifactReadGrant},
];
type Kind=typeof KINDS[number];
const valid=(ttl:number):Record<string,unknown>=>({sub:'usr_bob',aud:SERVICE.origin,svc:SERVICE.id,iat:NOW_S,exp:NOW_S+ttl,jti:'vtk_1',par:{kind:'session',id:'ses_1'}});
/** A token of this kind carrying exactly `body` (any JSON text), correctly signed. */
const signed=(kind:Kind,body:string)=>{const encoded=Buffer.from(body).toString('base64url');return `${kind.prefix}${encoded}.${createHmac('sha256',kind.key).update(kind.prefix+encoded).digest('base64url')}`;};
const claims=(kind:Kind,change:(c:Record<string,unknown>)=>void)=>{const c=valid(kind.ttl);change(c);return signed(kind,JSON.stringify(c));};

const MALFORMED:[string,(kind:Kind)=>string][]=[
 ['sub missing',k=>claims(k,c=>{delete c.sub;})],
 ['sub not an id',k=>claims(k,c=>{c.sub='usr bob';})],
 ['sub too long',k=>claims(k,c=>{c.sub='u'.repeat(129);})],
 ['sub a number',k=>claims(k,c=>{c.sub=7;})],
 ['aud not a string',k=>claims(k,c=>{c.aud=1;})],
 ['svc not a string',k=>claims(k,c=>{c.svc=null;})],
 ['jti not a string',k=>claims(k,c=>{c.jti=1;})],
 ['iat not an integer',k=>claims(k,c=>{c.iat=NOW_S+0.5;})],
 ['iat a string',k=>claims(k,c=>{c.iat=String(NOW_S);})],
 ['exp not an integer',k=>claims(k,c=>{c.exp=NOW_S+1.5;})],
 ['exp missing',k=>claims(k,c=>{delete c.exp;})],
 ['lifetime over the limit',k=>claims(k,c=>{c.exp=NOW_S+k.ttl+1;})],
 ['issued in the future, past the skew',k=>claims(k,c=>{c.iat=NOW_S+6;c.exp=NOW_S+6+k.ttl;})],
 ['expired',k=>claims(k,c=>{c.iat=NOW_S-k.ttl;c.exp=NOW_S;})],
 ['parent missing',k=>claims(k,c=>{delete c.par;})],
 ['parent not an object',k=>claims(k,c=>{c.par='ses_1';})],
 ['parent of another kind',k=>claims(k,c=>{c.par={kind:'group',id:'g_1'};})],
 ['parent id not an id',k=>claims(k,c=>{c.par={kind:'token',id:'not an id'};})],
 ['parent id missing',k=>claims(k,c=>{c.par={kind:'token'};})],
 ['audience not configured',k=>claims(k,c=>{c.svc='crm';})],
 ['audience moved origin',k=>claims(k,c=>{c.aud='https://warehouse2.example';})],
 ['claims null',k=>signed(k,'null')],
 ['claims a number',k=>signed(k,'7')],
 ['claims not JSON',k=>signed(k,'{not json')],
 ['another prefix',k=>signed(k,JSON.stringify(valid(k.ttl))).replace(k.prefix,k.prefix==='vwt_'?'arg_':'vwt_')],
 ['a third segment',k=>signed(k,JSON.stringify(valid(k.ttl)))+'.x'],
 ['a bad signature',k=>signed(k,JSON.stringify(valid(k.ttl))).slice(0,-2)+'AA'],
 ['no signature',k=>signed(k,JSON.stringify(valid(k.ttl))).split('.')[0]!+'.'],
 ['over 2048 characters',k=>claims(k,c=>{c.jti='j'.repeat(2048);})],
];

describe.each(KINDS)('a $name',kind=>{
 it('accepts the well-formed claims and its own issue',()=>{
  expect(kind.verify(kind.key,[SERVICE],signed(kind,JSON.stringify(valid(kind.ttl))),NOW)).toEqual(valid(kind.ttl));
  const issued=kind.sign(kind.key,SERVICE,{userId:'usr_bob',parent:{kind:'token',id:'tok_1'}},NOW);
  expect(issued).toEqual({token:expect.stringMatching(new RegExp(`^${kind.prefix}[\\w-]+\\.[\\w-]+$`)),audience:SERVICE.origin,expiresAt:new Date(NOW+kind.ttl*1000).toISOString()});
  expect(kind.verify(kind.key,[SERVICE],issued.token,NOW)).toEqual({...valid(kind.ttl),jti:expect.stringMatching(/^vtk_/),par:{kind:'token',id:'tok_1'}});
 });
 it.each(MALFORMED)('refuses %s',(_,make)=>{
  expect(kind.verify(kind.key,[SERVICE],make(kind),NOW)).toBeNull();
 });
 it('refuses to issue for an invalid user or parent',()=>{
  expect(()=>kind.sign(kind.key,SERVICE,{userId:'usr bob',parent:{kind:'token',id:'tok_1'}},NOW)).toThrow('invalid_user');
  for(const parent of [undefined,{kind:'group',id:'g_1'},{kind:'token',id:'not an id'}])
   expect(()=>kind.sign(kind.key,SERVICE,{userId:'usr_bob',parent:parent as never},NOW),JSON.stringify(parent)).toThrow('invalid_parent');
 });
});
