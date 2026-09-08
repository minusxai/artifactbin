import { describe, expect, it } from 'vitest';
import { parseJsx, serializeJsx, validateJsxSource } from '../index';
import { STORY_UI_COMPONENT_NAME_LIST, STORY_HTML_TAGS } from '@/lib/story-ui/component-names';
import { stampNodeIds, nodeIndex } from '@/lib/story/node-ids';
import { collectRefUses } from '@/lib/story/refs';
import { collectRefNameUses, validateDataflow } from '@/lib/story/dataflow';
import { splitHelmet, hoistHelmet } from '@/lib/story/helmet';
import {applyDomEditsToJsx, removeJsxNodeAtPath} from '@/lib/data/story/jsx-edit';

const nodes = (source: string) => {const p = parseJsx(source); if (!p.ok) throw new Error(p.error); return p.nodes;};
const validate = (source: string) => validateJsxSource(source, STORY_UI_COMPONENT_NAME_LIST, STORY_HTML_TAGS);
describe('conditional JSX as structural data', () => {
  it.each(['{$show && <Card>Yes</Card>}', '{$view === "dag" ? <Card>DAG</Card> : <p>Table</p>}', '{$a ? <><p>A</p><p>B</p></> : ($b && <p>C</p>)}'])('round-trips and validates %s', source => {
    expect(validate(source)).toEqual([]);
    const serialized = serializeJsx(nodes(source));
    expect(validate(serialized)).toEqual([]);
    expect(serializeJsx(nodes(serialized))).toBe(serialized);
  });
  it('indexes and stamps real elements in BOTH branches, not structural wrappers', () => {
    const stamped = stampNodeIds('{$show ? <p>Yes</p> : <p>No</p>}');
    expect(stamped.ids).toHaveLength(2);
    expect([...nodeIndex(stamped.source).values()].map(e => e.node.tag)).toEqual(['p', 'p']);
    expect(stampNodeIds(stamped.source).source).toBe(stamped.source);
  });
  it('edits and deletes a visible branch without losing the hidden branch or its node identity', () => {
    const source = '{$show ? <p id="yes">Yes</p> : <p id="no">No</p>}';
    const edited = applyDomEditsToJsx(source, [{astPath:'0.0.0', innerHtml:'Changed'}]);
    expect(edited.errors).toEqual([]);
    expect(edited.source).toContain('<p id="yes">Changed</p>');
    expect(edited.source).toContain('<p id="no">No</p>');
    const removed = removeJsxNodeAtPath(edited.source, '0.0.0');
    expect(validate(removed)).toEqual([]);
    expect([...nodeIndex(removed).keys()]).toEqual(['no']);
  });
  it('discovers references even when their branch is hidden', () => {
    expect(collectRefUses('{false && <img src="ref:abc123" />}')).toMatchObject([{id: 'abc123', kind: 'image'}]);
  });
  it('reports undeclared signals in conditions and reactive text', () => {
    const {content, body} = splitHelmet(nodes('<Helmet><Value name="show" type="boolean" /></Helmet>{$show && <p>{$missing}</p>}'));
    const uses = collectRefNameUses(body);
    expect(uses.map(u => u.name)).toEqual(['show', 'missing']);
    expect(validateDataflow({values: content.values, queries: []}, uses)).toHaveLength(1);
  });
  it.each(['{window.ready && <p>Bad</p>}', '{fetch("x") ? <p>A</p> : <p>B</p>}', '{false && <script>{`alert(1)`}</script>}', '{false && <img onError="bad" />}', '<__mx_condition />'])('rejects unsafe hidden markup or predicates: %s', source => {
    expect(validate(source).length).toBeGreaterThan(0);
  });
  it('allows only scalar boolean-property expressions, not executable handlers or dynamic URLs', () => {
    expect(validate('<button disabled={$_row.busy}>Save</button>').length).toBeGreaterThan(0);
    expect(validate('<button disabled={$busy}>Save</button>')).toEqual([]);
    expect(validate('<div hidden={!$open} />')).toEqual([]);
    expect(validate('<a href={$url}>Go</a>').length).toBeGreaterThan(0);
    expect(validate('<button onClick={$action}>Go</button>').length).toBeGreaterThan(0);
  });
  it('keeps branch structure when Helmet canonicalization removes nested metadata', () => {
    const source = '{$show ? <><Helmet><title>Hi</title></Helmet><p>Yes</p></> : <p>No</p>}';
    const normalized = serializeJsx(hoistHelmet(nodes(source)));
    expect(normalized).toContain('<title>Hi</title>');
    expect(normalized).toContain('Yes');
    expect(normalized).toContain('No');
    expect(stampNodeIds(normalized).ids).toHaveLength(2);
  });
});
