/**
 * composeSource — the no-clobber invariant.
 *
 * The frame stages edits and the parent folds them in. The rule that matters:
 * a commit re-applies the WHOLE pending set against the current source, so a
 * text edit never re-derives the source without the formats applied since, and
 * a format never discards typing. Getting this wrong loses the user's work
 * silently, which is the worst way to lose it.
 */
import { describe, it, expect } from 'vitest';
import { bodyPathToSourcePath, composeSource, hasPendingEdits, helmetOffset, NO_PENDING_EDITS, type PendingEdits } from '../edit-compose';
import { parseJsx } from '@/lib/jsx';

const SRC = '<div className="p-4"><h1 className="t">Title</h1><p className="lede">hello</p></div>';
const pending = (over: Partial<PendingEdits> = {}): PendingEdits => ({ ...NO_PENDING_EDITS, ...over });

describe('composeSource', () => {
  it('writes an edited host\'s content into the source', () => {
    const out = composeSource(SRC, pending({ text: new Map([['0.1', 'goodbye']]) }));
    expect(out).toContain('<p className="lede">goodbye</p>');
    expect(out).toContain('<h1 className="t">Title</h1>');
  });

  it('writes a format edit', () => {
    const out = composeSource(SRC, pending({ format: new Map([['0.0', { className: 'text-5xl' }]]) }));
    expect(out).toContain('<h1 className="text-5xl">Title</h1>');
  });

  it('COMPOSES text and format on the same node — neither discards the other', () => {
    const out = composeSource(SRC, pending({
      text: new Map([['0.1', 'edited text']]),
      format: new Map([['0.1', { className: 'lede text-xl' }]]),
    }));
    expect(out).toContain('className="lede text-xl"');
    expect(out).toContain('edited text');
  });

  it('composes edits to DIFFERENT nodes', () => {
    const out = composeSource(SRC, pending({
      text: new Map([['0.0', 'New title'], ['0.1', 'New body']]),
      format: new Map([['0.0', { style: 'color: red' }]]),
    }));
    expect(out).toContain('New title');
    expect(out).toContain('New body');
    expect(out).toContain('style="color: red"');
  });

  it('is the identity when nothing is pending', () => {
    expect(composeSource(SRC, NO_PENDING_EDITS)).toBe(SRC);
  });

  it('SANITIZES what a contenteditable produced — a paste gets no editor trust', () => {
    const out = composeSource(SRC, pending({
      text: new Map([['0.1', 'safe<script>alert(1)</script><b onclick="x()">bold</b>']]),
    }));
    expect(out).not.toMatch(/<script|onclick/i);
    expect(out).toContain('safe');
    expect(out).toContain('bold');
  });

  it('drops a stale path rather than corrupting the body', () => {
    const out = composeSource(SRC, pending({ text: new Map([['9.9', 'nowhere']]) }));
    expect(out).not.toContain('nowhere');
    expect(out).toContain('hello');
  });

  it('returns the source unchanged when it does not parse', () => {
    const broken = '<div><p>unclosed';
    expect(composeSource(broken, pending({ text: new Map([['0.0', 'x']]) }))).toBe(broken);
  });

  it('removes an attribute when the format edit is empty', () => {
    const out = composeSource(SRC, pending({ format: new Map([['0.0', { className: '' }]]) }));
    expect(out).toContain('<h1>Title</h1>');
  });

  it('never lets a component be text-edited — its DOM is render chrome', () => {
    const withEmbed = '<div className="p-4"><Question data="$q" /></div>';
    const out = composeSource(withEmbed, pending({ text: new Map([['0.0', 'not source']]) }));
    expect(out).not.toContain('not source');
    expect(out).toContain('<Question data="$q" />');
  });

  it('applies a layout rect to a GridItem', () => {
    const grid = '<div><Grid><GridItem x={0} y={0} w={2} h={2}><p>cell</p></GridItem></Grid></div>';
    const out = composeSource(grid, pending({ layout: new Map([['0.0.0', { x: 3, y: 1, w: 4, h: 5 }]]) }));
    expect(out).toMatch(/x=\{3\}/);
    expect(out).toMatch(/w=\{4\}/);
  });
});

describe('hasPendingEdits', () => {
  it('is false only when every kind is empty', () => {
    expect(hasPendingEdits(NO_PENDING_EDITS)).toBe(false);
    expect(hasPendingEdits(pending({ text: new Map([['0.1', 'x']]) }))).toBe(true);
    expect(hasPendingEdits(pending({ format: new Map([['0.1', {}]]) }))).toBe(true);
    expect(hasPendingEdits(pending({ layout: new Map([['0.1', { x: 0, y: 0, w: 1, h: 1 }]]) }))).toBe(true);
  });
});


/**
 * THE OFF-BY-ONE THAT ONLY BITES DOCUMENTS WITH DATA.
 *
 * The document renders the BODY — the Helmet is split off before anything is
 * stamped — so every path it reports is body-relative. The source is not.
 * A document of pure prose has no Helmet, works perfectly, and hides this
 * completely; the first document with a <Value> edits the wrong element.
 */
const HELMET = '<Helmet><Value name="rows" type="table" value={[]} /></Helmet>';
const BODY = '<div className="p-4"><h1>Title</h1><p className="lede">hello</p></div>';

describe('body paths versus source paths', () => {
  it('knows when a source begins with a Helmet', () => {
    const nodesOf = (src: string) => { const p = parseJsx(src); if (!p.ok) throw new Error('bad fixture'); return p.nodes; };
    expect(helmetOffset(nodesOf(HELMET + BODY))).toBe(1);
    expect(helmetOffset(nodesOf(BODY))).toBe(0);
  });

  it('shifts only the FIRST index, and only when there is a Helmet', () => {
    expect(bodyPathToSourcePath(HELMET + BODY, '0.1')).toBe('1.1');
    expect(bodyPathToSourcePath(HELMET + BODY, '0')).toBe('1');
    expect(bodyPathToSourcePath(BODY, '0.1')).toBe('0.1');
  });

  it('leaves a nonsense path alone rather than inventing one', () => {
    expect(bodyPathToSourcePath(HELMET + BODY, 'nope')).toBe('nope');
    expect(bodyPathToSourcePath('<div><p>unclosed', '0.1')).toBe('0.1');
  });

  it('EDITS THE RIGHT ELEMENT in a document that declares data', () => {
    // '0.1' is the <p> in the body; in the source that is '1.1'.
    const out = composeSource(HELMET + BODY, pending({ text: new Map([['0.1', 'goodbye']]) }));
    expect(out).toContain('<p className="lede">goodbye</p>');
    expect(out).toContain('<h1>Title</h1>');
    expect(out).toContain('<Value name="rows"');
  });

  it('formats the right element in a document that declares data', () => {
    const out = composeSource(HELMET + BODY, pending({ format: new Map([['0.0', { className: 'text-5xl' }]]) }));
    expect(out).toContain('<h1 className="text-5xl">Title</h1>');
  });
});

describe('composeSource — kit text components', () => {
  /** A dashboard: a card title, a kit table (one cell typed, one from data) and an alert. */
  const KIT = '<Card id="card"><CardHeader id="hd"><CardTitle id="ct" className="text-lg">Revenue</CardTitle></CardHeader>'
    + '<CardContent id="cc"><Table id="t"><TableBody id="tb"><TableRow id="r"><TableCell id="eVAF">Wed</TableCell><TableCell id="tot">{$q.rows[0].total}</TableCell></TableRow></TableBody></Table></CardContent></Card>'
    + '<Alert id="al" variant="destructive"><AlertTitle id="at">Heads up</AlertTitle><AlertDescription id="ad">Numbers are provisional.</AlertDescription></Alert>';
  const CELL = '0.1.0.0.0.0', DATA_CELL = '0.1.0.0.0.1', TITLE = '0.0.0', ALERT_TITLE = '1.0';
  const nodeAt = (source: string, path: string) => {
    const parsed = parseJsx(source);
    if (!parsed.ok) throw new Error('output does not parse');
    let list = parsed.nodes, node = null as (typeof parsed.nodes)[number] | null;
    for (const index of path.split('.').map(Number)) { node = list[index] ?? null; list = node?.type === 'element' ? node.children : []; }
    if (node?.type !== 'element') throw new Error(`no element at ${path}`);
    return node;
  };

  it('writes only the children: <TableCell id="eVAF">Wed</TableCell> becomes Thu, id and every prop unchanged', () => {
    expect(composeSource(KIT, pending({ text: new Map([[CELL, 'Thu']]) }))).toBe(KIT.replace('>Wed<', '>Thu<'));
  });

  it('edits a card title and an alert title in one commit, keeping their props', () => {
    const out = composeSource(KIT, pending({ text: new Map([[TITLE, 'Net revenue'], [ALERT_TITLE, 'Careful']]) }));
    expect(out).toBe(KIT.replace('>Revenue<', '>Net revenue<').replace('>Heads up<', '>Careful<'));
  });

  it('keeps the inline marks the component accepts', () => {
    const out = composeSource(KIT, pending({ text: new Map([[CELL, '<b>Thu</b>rsday <a href="https://example.com/notes">notes</a>']]) }));
    expect(out).toContain('<TableCell id="eVAF"><b>Thu</b>rsday <a href="https://example.com/notes">notes</a></TableCell>');
  });

  it('a link component takes no link inside it: the link\'s words stay, the link goes', () => {
    const crumb = '<BreadcrumbList id="bl"><BreadcrumbItem id="bi"><BreadcrumbLink id="bk" href="/reports">Reports</BreadcrumbLink></BreadcrumbItem></BreadcrumbList>';
    const out = composeSource(crumb, pending({ text: new Map([['0.0.0', '<em>All</em> <a href="https://example.com">reports</a>']]) }));
    expect(out).toBe('<BreadcrumbList id="bl"><BreadcrumbItem id="bi"><BreadcrumbLink id="bk" href="/reports"><em>All</em> reports</BreadcrumbLink></BreadcrumbItem></BreadcrumbList>');
  });

  it('never writes markup, script, handlers, styles or another component into the text', () => {
    const hostile = '<div onclick="steal()">Thu</div><script>alert(1)</script><img src="x" onerror="steal()"><span data-mx-ast="1">alert</span>'
      + '<strong style="color:red" onmouseover="steal()">day</strong><p>next</p>';
    const out = composeSource(KIT, pending({ text: new Map([[CELL, hostile]]) }));
    const cell = nodeAt(out, CELL);
    expect(cell.attributes.map((a) => [a.name, a.value])).toEqual([['id', { static: true, json: 'eVAF' }]]);
    expect(out).toContain('<TableCell id="eVAF">Thu<strong>day</strong>next</TableCell>');
    expect(out).not.toMatch(/<script|alert|steal|onclick|onerror|onmouseover|style=|<img|<div|<p>/);
    // The Alert the hostile stamp pointed at is still exactly where it was, once.
    expect(out.match(/<Alert /g)).toHaveLength(1);
  });

  it('escapes typed angle brackets and braces: they stay text through save and reparse', () => {
    const out = composeSource(KIT, pending({ text: new Map([[CELL, 'a &lt;b&gt; {c} &amp; d']]) }));
    const cell = nodeAt(out, CELL);
    expect(cell.children).toHaveLength(1);
    expect(cell.children[0]).toMatchObject({ type: 'text', value: 'a <b> {c} & d' });
  });

  it('refuses text for a cell whose text comes from data, and for a layout shell', () => {
    expect(composeSource(KIT, pending({ text: new Map([[DATA_CELL, '42']]) }))).toBe(KIT);
    expect(composeSource(KIT, pending({ text: new Map([['0', 'flattened']]) }))).toBe(KIT);
    expect(composeSource(KIT, pending({ text: new Map([['1', 'flattened']]) }))).toBe(KIT);
  });
});

describe('composeSource — data bindings in plain HTML text', () => {
  /** A document that declares data: every path the document reports is body-relative. */
  const DOC = '<Helmet><Value name="x" type="number" default={42} /></Helmet>'
    + '<div id="main"><p id="tot">Total: {$x} items</p><p id="mix">Mixed <strong id="mst">bold</strong> next to {$x}</p>'
    + '<p id="ic">Done <Icon id="icn" name="circle-check" /> now</p><p id="num">Revenue <Number id="nm" data="$q" col="total" /></p></div>';
  const TOTAL = '0.0', MIX = '0.1', MARK = '0.1.1', ICON_P = '0.2', NUMBER_P = '0.3';

  it('refuses the rendered value typed over a binding — the source keeps {$x}', () => {
    // What the hosted editor wrote before the rule: the expression replaced by its value.
    expect(composeSource(DOC, pending({ text: new Map([[TOTAL, 'Total: 42 items total']]) }))).toBe(DOC);
    expect(composeSource(DOC, pending({ text: new Map([[NUMBER_P, 'Revenue <span data-mx-ast="0.3.1">1,204</span> up']]) }))).toBe(DOC);
  });

  it('a mark inside text is part of it: never addressed on its own, even when it holds no binding', () => {
    expect(composeSource(DOC, pending({ text: new Map([[MIX, 'Mixed <strong>bold</strong> next to 42 now']]) }))).toBe(DOC);
    expect(composeSource(DOC, pending({ text: new Map([[MARK, 'bolder']]) }))).toBe(DOC);
  });

  it('a static embed\'s own stamp splices it back where the document reports it, under a Helmet', () => {
    const out = composeSource(DOC, pending({ text: new Map([[ICON_P, 'All done <svg data-mx-ast="0.2.1" contenteditable="false"></svg> for real']]) }));
    expect(out).toBe(DOC.replace('Done <Icon', 'All done <Icon').replace('/> now</p>', '/> for real</p>'));
  });
});
