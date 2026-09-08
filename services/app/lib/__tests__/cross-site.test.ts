import {describe,expect,it} from 'vitest';
import {isCrossSiteRequest,parseCookie} from '@/lib/http';
import {PUBLIC_BASE_URL,CONTROLS_ORIGIN} from '@/lib/config';
const origin=CONTROLS_ORIGIN??new URL(PUBLIC_BASE_URL).origin;
describe('isCrossSiteRequest',()=>{
  const check=(headers:Record<string,string>)=>isCrossSiteRequest(new Request('http://internal:3000/api/x',{method:'POST',headers}));
  it('requires explicit browser proof, never missing Origin or same-site alone',()=>{
    const incomplete:Record<string,string>[]=[{},{origin},{'sec-fetch-site':'same-origin'},{origin,'x-artifactbin-csrf':'1','sec-fetch-site':'same-site'}];
    for(const headers of incomplete)expect(check(headers)).toBe(true);
    expect(check({origin,'x-artifactbin-csrf':'1'})).toBe(false);
    expect(check({origin,'x-artifactbin-csrf':'1','sec-fetch-site':'same-origin'})).toBe(false);
  });
  it('uses exact deployment origin, not conflicting metadata or forwarded hosts',()=>{
    for(const foreign of ['null','https://evil.test','http://evil.test','not a url',origin.replace(/^https:/,'http:')+'evil']){
      expect(check({origin:foreign,'x-artifactbin-csrf':'1','sec-fetch-site':'same-origin','x-forwarded-host':'evil.test',host:'evil.test'})).toBe(true);
    }
    expect(check({origin,'x-artifactbin-csrf':'1','sec-fetch-site':'cross-site'})).toBe(true);
  });
});
describe('parseCookie', () => {
  it('reads one cookie out of a header, whitespace and all', () => {
    expect(parseCookie('a=1; b=2', 'b')).toBe('2');
    expect(parseCookie('  a=1 ;  b=2  ', 'b')).toBe('2');
  });

  it('matches the WHOLE name — never a prefix or suffix of another', () => {
    const header = 'mx-agent-session=REAL; not-mx-agent-session=DECOY; mx-agent-session-x=DECOY2';
    expect(parseCookie(header, 'mx-agent-session')).toBe('REAL');
    // …and reading a name that is only a prefix of a present one finds nothing.
    expect(parseCookie('mx-agent-session-x=DECOY2', 'mx-agent-session')).toBeUndefined();
  });

  it('returns the value UNDECODED — a JWE is already URL-safe, decoding invents failure modes', () => {
    expect(parseCookie('t=a.b%2Dc_d', 't')).toBe('a.b%2Dc_d');
  });

  it('is undefined for an absent name, an empty header, or none at all', () => {
    expect(parseCookie('a=1', 'b')).toBeUndefined();
    expect(parseCookie('', 'a')).toBeUndefined();
    expect(parseCookie(null, 'a')).toBeUndefined();
  });

  it('tolerates a malformed pair rather than throwing', () => {
    expect(parseCookie('novalue; a=1', 'a')).toBe('1');
  });
});
