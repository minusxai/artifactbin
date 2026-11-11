/** What a group may approve of a declared set: exact connect, img and media origins only, never code or a wildcard. */
import { expect, it } from 'vitest';
import { EMPTY_CSP_EXTENSIONS, GROUP_CSP_DIRECTIVES, groupEligibleCspExtensions } from '../csp-extensions';

it('keeps the data directives\' exact origins and drops script, style, frame and every wildcard', () => {
  expect(GROUP_CSP_DIRECTIVES).toEqual(['connect', 'img', 'media']);
  expect(groupEligibleCspExtensions({
    connect: ['https://api.example.com', 'https://*.example.com'], img: ['https://img.example.com:8443'], media: ['https://*.cdn.example.com'],
    script: ['https://cdn.plot.ly'], style: ['https://fonts.example.com'], frame: ['https://www.youtube-nocookie.com'],
  })).toEqual({ ...EMPTY_CSP_EXTENSIONS, connect: ['https://api.example.com'], img: ['https://img.example.com:8443'] });
});
