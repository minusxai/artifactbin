import {describe,expect,it} from 'vitest';
import {storyPresentationCss,storyPresentationFontPreloads} from '../presentation-css';
import {EMPTY_HELMET_CONTENT} from '../helmet';

describe('storyPresentationCss',()=>{
  it('includes document deck, outline, and presentation geometry',()=>{
    const css=storyPresentationCss(null,EMPTY_HELMET_CONTENT);
    expect(css).toContain('.mx-deck { display: flex');
    expect(css).toContain('flex: 0 0 190px');
    expect(css).toContain('.mx-present {');
    expect(css).toContain('.mx-outline {');
  });

  it('does not bring retired reader-control styling into the direct surface',()=>{
    const css=storyPresentationCss(null,EMPTY_HELMET_CONTENT);
    expect(css).not.toContain('.mx-reader-chrome');
    expect(css).not.toContain('#mx-controls-loading');
  });

  it('returns unique critical and imported font preload URLs for the direct head',()=>{
    const preloads=storyPresentationFontPreloads('manuscript',[
      {family:'Imported',url:'/fonts/imported.woff2',preload:true},
      {family:'Imported',url:'/fonts/imported.woff2',preload:true},
      {family:'Lazy',url:'/fonts/lazy.woff2',preload:false},
    ]);
    expect(preloads.filter(url=>url==='/fonts/imported.woff2')).toHaveLength(1);
    expect(preloads.length).toBeGreaterThan(1);
    expect(preloads).not.toContain('/fonts/lazy.woff2');
  });
});
