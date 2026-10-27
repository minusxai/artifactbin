import {describe,expect,it} from 'vitest';
import {canonicalizeHtmlPage,htmlAppearance,normalizeDesignSelection} from '../index';

const page=(html:string,head='')=>`<!doctype html>${html}<head><meta charset="utf-8"><title>t</title>${head}</head><body><p>x</p></body></html>`;

describe('design selection (D1/D2)',()=>{
 it('stores no platform attributes or copied system stylesheet through the server canonical path, idempotently',()=>{
  const once=canonicalizeHtmlPage(page('<html data-af-design-system="riso" data-af-dark="true">','<link data-af="design-system" rel="stylesheet" href="/a/X/assets?dependency=a&amp;revision=1">')).html;
  expect(once).not.toMatch(/data-af-dark|data-af-design-system|data-af="design-system"/);
  expect(once).toContain('<meta name="artifactbin:design-system" content="riso"');
  expect(canonicalizeHtmlPage(once).html).toBe(once);
  expect(normalizeDesignSelection(once).changed).toBe(false);
 });
 it('drops a stored dark attribute without inventing a system, and keeps an author meta',()=>{
  expect(normalizeDesignSelection(page('<html data-af-dark="false">')).html).toBe(page('<html>'));
  const kept=normalizeDesignSelection(page('<html data-af-design-system="riso">','<meta name="artifactbin:design-system" content="volta">')).html;
  expect(kept.match(/artifactbin:design-system/g)).toHaveLength(1);expect(kept).toContain('content="volta"');
 });
});

describe('appearance the core applies (D4)',()=>{
 it('resolves owner choice › meta › stored attribute, and the mode from a stored attribute › the system default',()=>{
  expect(htmlAppearance(page('<html>','<meta name="artifactbin:design-system" content="nocturne">'))).toEqual({designSystem:'nocturne',mode:'dark'});
  expect(htmlAppearance(page('<html>','<meta name="artifactbin:design-system" content="redline">'))).toEqual({designSystem:'redline',mode:'light'});
  expect(htmlAppearance(page('<html data-af-design-system="riso" data-af-dark="true">'))).toEqual({designSystem:'riso',mode:'dark'});
  expect(htmlAppearance(page('<html>','<meta name="artifactbin:design-system" content="redline">'),'phosphor')).toEqual({designSystem:'phosphor',mode:'dark'});
  expect(htmlAppearance(page('<html>','<meta name="artifactbin:design-system" content="nope">'))).toEqual({mode:'light'});
  expect(htmlAppearance(page('<html>'))).toEqual({mode:'light'});
 });
});
