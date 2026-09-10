import { describe, it, expect } from 'vitest';
import { editBlock } from '../block-edit';
const source = '<div><p id="a">first</p><p id="b">second</p><p id="c">third</p></div>';
describe('source block commands', () => {
  it('moves a block among siblings without copying its identity', () => {
    expect(editBlock(source, { kind: 'move', path: '0.0', target: '0.2' })).toBe(
      '<div><p id="b">second</p><p id="c">third</p><p id="a">first</p></div>',
    );
  });
  it('deletes multiple blocks atomically and refuses any stale target', () => {
    expect(editBlock(source, { kind: 'delete', paths: ['0.0', '0.2'] })).toBe('<div><p id="b">second</p></div>');
    expect(editBlock(source, { kind: 'delete', paths: ['0.0', '99'] })).toBe(source);
  });
  it('resizes prose without fixed height or clipped overflow, and resets minimum height', () => {
    const next = editBlock(source, {
      kind: 'resize',
      path: '0.0',
      width: 350,
      height: 200,
    });
    expect(next).toContain('w-[350px]');
    expect(next).toContain('min-h-[200px]');
    expect(next).not.toContain(' h-[200px]');
    expect(editBlock(next, { kind: 'auto-height', path: '0.0' })).not.toContain('min-h-[');
  });
  it('writes flow Grid width and minimum-height geometry through existing w/minHeight props', () => {
    const grid = '<Grid mode="flow" cols={12} rowHeight={50}><GridItem id="a" w={6}><p>text</p></GridItem></Grid>';
    const resized = editBlock(grid, {
      kind: 'resize',
      path: '0.0',
      width: 7,
      height: 200,
      grid: true,
    });
    expect(resized).toContain('w={7} minHeight={200}');
    expect(editBlock(resized, { kind: 'auto-height', path: '0.0' })).not.toContain('minHeight=');
  });
});

it('leaves empty editable paragraphs in columns after deleting their last text blocks', () => {
  const source =
    '<Grid mode="flow"><GridItem id="left"><p id="a">one</p></GridItem><GridItem id="right"><p id="b">two</p></GridItem></Grid>';
  expect(editBlock(source, { kind: 'delete', paths: ['0.0.0', '0.1.0'] }).replace(/<p id="e[a-f0-9]+">/g, '<p>')).toBe(
    '<Grid mode="flow"><GridItem id="left"><p></p></GridItem><GridItem id="right"><p></p></GridItem></Grid>',
  );
});

it('redistributes a paired flow divider and preserves total row width', () => {
  const source =
    '<Grid mode="flow" cols={12}><GridItem w={6}><p>left</p></GridItem><GridItem w={6}><p>right</p></GridItem></Grid>';
  const result = editBlock(source, { kind: 'divider', path: '0.0', width: 8 });
  expect(result).toContain('w={8}');
  expect(result).toContain('w={4}');
});

it('leaves an editable paragraph after deleting the last block in a slide or table cell',()=>{
 for(const [source,path]of [
  ['<SlideDeck><Slide id="slide"><p id="text">words</p></Slide></SlideDeck>','0.0.0'],
  ['<table><tbody><tr><td id="cell"><p id="text">words</p></td></tr></tbody></table>','0.0.0.0.0'],
 ]) {
  const result=editBlock(source,{kind:'delete',paths:[path]});expect(result).not.toContain('words');expect(result).toMatch(/<p id="e[a-f0-9]+"><\/p>/);
 }
});
