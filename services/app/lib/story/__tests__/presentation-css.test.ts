import {describe,expect,it} from 'vitest';
import {storyPresentationCss} from '../presentation-css';
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
});
