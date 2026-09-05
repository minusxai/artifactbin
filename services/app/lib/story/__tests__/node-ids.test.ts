import { describe, expect, it } from 'vitest';
import { stampNodeIds, nodeIndex } from '../node-ids';
import { canonicalizeMarkup } from '../jsx-tier';

const mint = (...ids: string[]) => { let index=0; return ()=>ids[index++] ?? `z${String(index).padStart(3,'0')}`; };
describe('persisted source node identity', () => {
  it('stamps native, SVG and component body nodes but excludes Helmet subtree', () => {
    const result=stampNodeIds('<Helmet><title>T</title></Helmet><main><p>A</p><svg><path d="M0 0" /></svg><Card>Hi</Card></main>',{mint:mint('a001','a002','a003','a004','a005')});
    expect(result.ids).toEqual(['a001','a002','a003','a004','a005']);
    expect(result.minted).toBe(5);
    expect(result.source).toContain('<Helmet><title>T</title></Helmet>');
    expect(nodeIndex(result.source).size).toBe(5);
  });
  it('preserves authored ids and avoids future authored ids when minting earlier nodes', () => {
    const result=stampNodeIds('<div><p id="a001">Hi</p></div>',{mint:mint('a001','a002')});
    expect(result.ids).toEqual(['a002','a001']);
    expect(nodeIndex(result.source).get('a001')?.node.tag).toBe('p');
  });
  it('never mints an id from the lifetime reservation ledger', () => {
    const result=stampNodeIds('<p>Hi</p>',{reservedIds:['a001'],mint:mint('a001','a002')});
    expect(result.ids).toEqual(['a002']);
  });
  it('preserves an explicitly restored reserved id', () => {
    const result=stampNodeIds('<p id="a001">Hi</p>',{reservedIds:['a001'],mint:mint('a002')});
    expect(result.ids).toEqual(['a001']);
    expect(result.minted).toBe(0);
  });
  it('repairs duplicate ids preserving first occurrence and reports it', () => {
    const result=stampNodeIds('<p id="same">A</p><p id="same">B</p>',{mint:mint('a001')});
    expect(result.ids).toEqual(['same','a001']);
    expect(result.repairs).toEqual([{path:'1',from:'same',to:'a001',reason:'duplicate'}]);
  });
  it('keeps author ids containing escaped punctuation as a canonical fixpoint', () => {
    const source=canonicalizeMarkup('<p id="a&amp;b&quot;c">A</p>');
    const result=stampNodeIds(source);
    expect(result.source).toBe(source);
    expect(result.ids).toEqual(['a&b"c']);
  });
  it('converts lone legacy anchors, preserving conflicting authored ids with alias report', () => {
    const source='<p data-annotation-anchor="old">A</p><p id="intro" data-annotation-anchor="other">B</p>';
    const result=stampNodeIds(source);
    expect(result.ids).toEqual(['old','intro']);
    expect(result.aliases).toEqual([{legacyKey:'other',nodeId:'intro',path:'1'}]);
    expect(result.source).toContain('data-annotation-anchor="other"');
    expect(result.source).not.toContain('data-annotation-anchor="old"');
    const retired=stampNodeIds(source,{retireLegacyAliases:true});
    expect(retired.source).not.toContain('data-annotation-anchor');
    expect(retired.aliases).toEqual(result.aliases);
  });
  it('carries unique exact-content ids across reorder with no positional guessing', () => {
    const result=stampNodeIds('<p>B</p><p>A</p>',{previousSource:'<p id="aaaa">A</p><p id="bbbb">B</p>'});
    expect(result.ids).toEqual(['bbbb','aaaa']);
    expect(result.carried).toBe(2);
  });
  it('does not guess which identical sibling survived', () => {
    const result=stampNodeIds('<p>Same</p>',{previousSource:'<p id="aaaa">Same</p><p id="bbbb">Same</p>',mint:mint('cccc')});
    expect(result.ids).toEqual(['cccc']);
    expect(result.carried).toBe(0);
  });
  it('does not carry identity onto an unrelated same-tag replacement', () => {
    const result=stampNodeIds('<p>Entirely different</p>',{previousSource:'<p id="aaaa">Revenue grew</p>',mint:mint('bbbb')});
    expect(result.ids).toEqual(['bbbb']);
  });
  it('is byte stable once stamped and indexes accurate source spans', () => {
    const once=stampNodeIds('<main><p>A</p></main>',{mint:mint('aaaa','bbbb')});
    expect(stampNodeIds(once.source).source).toBe(once.source);
    const p=nodeIndex(once.source).get('bbbb')!;
    expect(once.source.slice(p.node.start,p.node.end)).toBe('<p id="bbbb">A</p>');
    expect(p.path).toBe('0.0');
  });
});
