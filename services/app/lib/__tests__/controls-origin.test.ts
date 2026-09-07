import {expect,it} from 'vitest';
import {parseControlsOrigin, controlsCorsHeaders} from '@artifactbin/utils';
it('accepts only an explicit sibling/subdomain origin or a distinct local port', () => {
  expect(parseControlsOrigin('https://artifactbin.test','https://i.artifactbin.test')).toBe('https://i.artifactbin.test');
  expect(parseControlsOrigin('http://localhost:3000','http://localhost:3001')).toBe('http://localhost:3001');
  for (const value of ['https://evil.test','https://i.artifactbin.test/path','https://u:p@i.artifactbin.test','http://i.artifactbin.test','https://artifactbin.test']) {
    expect(() => parseControlsOrigin('https://artifactbin.test',value)).toThrow();
  }
});
it('grants credentialed CORS to the one configured controls origin, not null, wildcard, or siblings', () => {
  const origin = 'https://i.artifactbin.test';
  expect(controlsCorsHeaders(origin,origin)).toMatchObject({'Access-Control-Allow-Origin':origin,'Access-Control-Allow-Credentials':'true'});
  for (const incoming of [null,'null','*','https://evil.artifactbin.test']) expect(controlsCorsHeaders(origin,incoming)).toBeNull();
});
it('permits secure-context localhost subdomains without relaxing non-loopback HTTP',()=>{
  expect(parseControlsOrigin('http://artifactbin.localhost:5400','http://i.artifactbin.localhost:5400')).toBe('http://i.artifactbin.localhost:5400');
  expect(()=>parseControlsOrigin('http://artifactbin.localhost.evil.test','http://i.artifactbin.localhost.evil.test')).toThrow();
});
