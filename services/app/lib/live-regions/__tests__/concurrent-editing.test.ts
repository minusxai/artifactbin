// @vitest-environment jsdom
/**
 * Named concurrent-editing scenarios through real EditorViews: keys go through the keymap, typed Markdown through
 * handleTextInput (so input rules fire), pastes through the clipboard parser. Every scenario ends with the room's
 * invariants (I1 identical HTML everywhere, I2 schema-valid, I3 unique ids, I5 compaction, I6 normal form) and states
 * its text (I4): what must survive. Nothing typed is ever lost; the one pinned limitation is formatting (two people
 * bolding overlapping ranges).
 * Client ids are fixed (A=1, B=2, C=3), so Yjs's tie-breaks, and so the expected HTML, are deterministic.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { canonicalizeHtmlPage } from '../../html-page';
import { LiveRegionRefusal, normalizeRegionHtml } from '..';
import { writeRegion } from '../html';
import { bare, idsOf, Room, type Client } from './harness';

let rooms: Room[] = [];
afterEach(() => { rooms.forEach((room) => room.destroy()); rooms = []; });
const open = (region: string, names?: string[], kind: 'rich' | 'text' = 'rich') => {
  const [room, ...clients] = Room.open(kind, region, names);
  rooms.push(room);
  return [room, ...clients] as [Room, Client, Client, Client];
};

interface Scenario {
  name: string;
  region: string;
  kind?: 'rich' | 'text';
  clients?: string[];
  run(room: Room, A: Client, B: Client, C: Client): void;
  /** The settled region without ids. */
  expected: string;
  /** I4: text typed by someone that must be present. */
  kept?: string[];
}
const runScenarios = (scenarios: Scenario[]) => it.each(scenarios.map((scenario) => [scenario.name, scenario] as const))('%s', (_name, scenario) => {
  const [room, A, B, C] = open(scenario.region, scenario.clients, scenario.kind);
  scenario.run(room, A, B, C);
  const html = room.invariants();
  expect(bare(html)).toBe(scenario.expected);
  for (const text of scenario.kept ?? []) expect(html, `I4 kept ${JSON.stringify(text)}`).toContain(text);
});

describe('Markdown shortcuts, concurrently', () => {
  runScenarios([
    { name: 'A types "# " at the start of a paragraph while B types inside it: the heading keeps B\'s text',
      region: '<p>Hello world</p>',
      run: (_room, A, B) => { A.select(A.blockStart(0)).type('# '); B.select(B.find('Hello', { after: true })).type(' there'); },
      expected: '<h1>Hello there world</h1>', kept: ['there'] },
    { name: 'A types "- " while B presses Enter in the same paragraph: the list item is the part after the Enter, whose line end A formatted',
      region: '<p>Hello world</p>',
      run: (_room, A, B) => { A.select(A.blockStart(0)).type('- '); B.select(B.find('Hello', { after: true })).key('Enter'); },
      expected: '<p>Hello</p><ul><li><p>world</p></li></ul>', kept: ['Hello', 'world'] },
    { name: 'A types "> " while B deletes the paragraph: the paragraph stays deleted',
      region: '<p>Keep</p><p>Quote me</p><p>End</p>',
      run: (_room, A, B) => { A.select(A.blockStart(1)).type('> '); B.delete(B.blockStart(1) - 1, B.blockStart(1, true) + 1); },
      expected: '<p>Keep</p><p>End</p>' },
    { name: 'known limitation: two users type ** around overlapping ranges; Yjs ends one bold where the other user\'s range ended, so "fox" is not bold',
      region: '<p>the quick brown fox</p>',
      run: (_room, A, B) => {
        A.select(A.find('quick')).type('**').select(A.find('brown', { after: true })).type('**');
        B.select(B.find('brown')).type('**').select(B.find('fox', { after: true })).type('**');
      },
      expected: '<p>the <strong>quick brown</strong> fox</p>' },
    { name: 'A converts to a code block while B adds bold inside: the code block wins, no text is lost',
      region: '<p>let x = 1</p>',
      run: (_room, A, B) => { A.select(A.blockStart(0)).type('```'); B.select(B.find('x'), B.find('x', { after: true })).key('b', { mod: true }); },
      expected: '<pre><code>let x = 1</code></pre>', kept: ['let x = 1'] },
    { name: '"1. " and "- " on the same paragraph at once: one list type wins everywhere',
      region: '<p>Item</p>',
      run: (_room, A, B) => { A.select(A.blockStart(0)).type('1. '); B.select(B.blockStart(0)).type('- '); },
      expected: '<ul><li><p>Item</p></li></ul>', kept: ['Item'] },
    { name: '"---" concurrently with typing in the paragraph after it',
      region: '<p>--</p><p>Next para</p>',
      run: (_room, A, B) => { A.select(A.blockStart(0, true)).type('-'); B.select(B.find('para', { after: true })).type(' more'); },
      expected: '<hr><p></p><p>Next para more</p>', kept: ['Next para more'] },
    { name: '"---" while someone types at the start of the same paragraph: the rule goes before, their typing stays in the paragraph',
      region: '<p>--</p>',
      run: (_room, A, B) => { A.select(A.blockStart(0, true)).type('-'); B.select(B.blockStart(0)).type('typed '); },
      expected: '<hr><p>typed</p>', kept: ['typed'] },
    { name: '"---" while someone types at the end of the same paragraph: the rule goes before, their typing stays in the paragraph',
      region: '<p>--</p>',
      run: (_room, A, B) => { A.select(A.blockStart(0, true)).type('-'); B.select(B.blockStart(0, true)).type(' typed'); },
      expected: '<hr><p>typed</p>', kept: ['typed'] },
    { name: 'converting to a code block while someone types in it keeps their typing',
      region: '<p>let x = 1</p>',
      run: (_room, A, B) => { A.select(A.blockStart(0)).type('```'); B.select(B.blockStart(0, true)).type(';'); },
      expected: '<pre><code>let x = 1;</code></pre>', kept: ['let x = 1;'] },
  ]);
});

describe('structure', () => {
  runScenarios([
    { name: 'concurrent Enter at the same position: two line breaks, nothing duplicated',
      region: '<p>Hello world</p>',
      run: (_room, A, B) => { A.select(A.find('Hello', { after: true })).key('Enter'); B.select(B.find('Hello', { after: true })).key('Enter'); },
      expected: '<p>Hello</p><p></p><p>world</p>', kept: ['Hello', 'world'] },
    { name: 'Backspace-joining two paragraphs while B types in the second keeps B\'s typing',
      region: '<p>First</p><p>Second</p>',
      run: (_room, A, B) => { A.select(A.blockStart(1)).key('Backspace'); B.select(B.find('Second', { after: true })).type(' typed'); },
      expected: '<p>FirstSecond typed</p>', kept: ['FirstSecond typed'] },
    { name: 'concurrent indent and outdent of one list item: the outdent\'s list removal and one depth win',
      region: '<ul><li>a</li><li>b</li><li>c</li></ul>',
      run: (_room, A, B) => { A.select(A.find('c')).key('Tab'); B.select(B.find('c')).key('Tab', { shift: true }); },
      expected: '<ul><li><p>a</p></li><li><p>b</p></li></ul><p>c</p>' },
    { name: 'deleting a block someone is typing in: the block goes, their typing survives',
      region: '<p>Keep</p><p>Doomed text</p><p>End</p>',
      run: (_room, A, B) => { A.delete(A.blockStart(1) - 1, A.blockStart(1, true) + 1); B.select(B.find('Doomed', { after: true })).type(' more'); },
      expected: '<p>Keep</p><p>moreEnd</p>', kept: ['more'] },
    { name: 'deleting the whole region while B types in its first block keeps B\'s typing',
      region: '<p>One</p><p>Two</p>',
      run: (_room, A, B) => { A.delete(A.blockStart(0), A.blockStart(1, true)); B.select(B.find('One', { after: true })).type(' typed'); },
      expected: '<p>typed</p>', kept: ['typed'] },
    { name: 'deleting the whole region while B types in a later block keeps B\'s typing',
      region: '<p>One</p><p>Two</p>',
      run: (_room, A, B) => { A.delete(A.blockStart(0), A.blockStart(1, true)); B.select(B.find('Two', { after: true })).type(' typed'); },
      expected: '<p>typed</p>', kept: ['typed'] },
    { name: 'nested lists three deep: typing in the deepest item while another user adds a fourth level',
      region: '<ul><li>a<ul><li>b<ol><li>c</li></ol></li></ul></li></ul>',
      run: (_room, A, B) => { A.select(A.find('c', { after: true })).type(' typed'); B.select(B.find('c', { after: true })).key('Enter').type('d').key('Tab'); },
      expected: '<ul><li><p>a</p><ul><li><p>b</p><ol><li><p>c typed</p><ol><li><p>d</p></li></ol></li></ol></li></ul></li></ul>', kept: ['c typed', 'd'] },
    { name: 'Enter in an empty list item leaves the list',
      region: '<ul><li>a</li></ul>',
      run: (_room, A) => { A.select(A.find('a', { after: true })).key('Enter').key('Enter').type('after'); },
      expected: '<ul><li><p>a</p></li></ul><p>after</p>', kept: ['after'] },
  ]);
});

describe('text', () => {
  runScenarios([
    { name: 'concurrent inserts at the same offset are ordered by client id', region: '<p>ab</p>',
      run: (_room, A, B) => { A.select(A.find('a', { after: true })).type('X'); B.select(B.find('a', { after: true })).type('Y'); },
      expected: '<p>aXYb</p>' },
    { name: 'the same inserts delivered B-first give the same order', region: '<p>ab</p>',
      run: (room, A, B) => { A.select(A.find('a', { after: true })).type('X'); B.select(B.find('a', { after: true })).type('Y'); room.send(B); room.send(A); room.receive(A); room.receive(B); },
      expected: '<p>aXYb</p>' },
    { name: 'emoji, surrogate pairs, combining characters, RTL and NBSP', region: '<p>x</p>',
      run: (_room, A, B) => { A.select(A.blockStart(0)).type('👩🏽‍💻 𝒳 é '); B.select(B.blockStart(0, true)).type(' שלום مرحبا'); },
      expected: '<p>👩🏽‍💻 𝒳 é x שלום&nbsp;مرحبا</p>' },
    { name: 'typed &, < and > are escaped', region: '<p>x</p>',
      run: (_room, A) => { A.select(A.blockStart(0, true)).type(' a & b < c > d &amp;'); },
      expected: '<p>x a &amp; b &lt; c &gt; d &amp;amp;</p>' },
    { name: 'pasted text with CRLF becomes paragraphs', region: '<p>Start</p>',
      run: (_room, A) => { A.select(A.blockStart(0, true)).pasteText(' one\r\ntwo\r\n\r\nthree'); },
      expected: '<p>Start one</p><p>two</p><p>three</p>' },
    { name: 'pasted text with CRLF in a code block keeps newlines', region: '<pre><code>a</code></pre>',
      run: (_room, A) => { A.select(A.blockStart(0, true)).pasteText('\r\nb\r\nc'); },
      expected: '<pre><code>a\nb\nc</code></pre>' },
    { name: 'an empty region: both type into it', region: '',
      run: (_room, A, B) => { A.type('Hi'); B.type('Yo'); },
      expected: '<p>HiYo</p>' },
    { name: 'a whitespace-only region is an empty region', region: '  \n ',
      run: (_room, A) => { A.type('typed'); },
      expected: '<p>typed</p>' },
    { name: 'a text region holds one line of plain text', region: 'Title', kind: 'text',
      run: (_room, A, B) => { A.select(A.blockStart(0, true)).type(' & more').key('Enter'); B.select(B.blockStart(0)).paste('<b>New</b> <script>x</script>'); },
      expected: 'NewTitle &amp; more' },
    { name: 'a text region joins the lines of a multi-line plain-text paste with spaces', region: 'Hello', kind: 'text',
      run: (_room, A) => { A.select(A.blockStart(0, true)).pasteText(' one\ntwo\r\nthree'); },
      expected: 'Hello one two three' },
    { name: 'a newline inserted into a paragraph\'s text becomes a space in the editor and the shared text alike', region: '<p>ab</p>',
      run: (_room, A) => { A.view.dispatch(A.state.tr.insertText('x\ny', A.find('a', { after: true }))); },
      expected: '<p>ax yb</p>' },
  ]);

  it('a 50,000-character paragraph: typing at both ends stays fast and converges', () => {
    const long = 'lorem ipsum '.repeat(4_200).trim().slice(0, 50_000);
    const [room, A, B] = open(`<p>${long}</p>`);
    const started = performance.now();
    A.select(A.blockStart(0)).type('Start ');
    B.select(B.blockStart(0, true)).type(' end');
    const html = room.invariants();
    expect(performance.now() - started).toBeLessThan(5_000);
    expect(bare(html)).toBe(`<p>Start ${long} end</p>`);
  });
});

describe('marks', () => {
  runScenarios([
    { name: 'overlapping bold and italic toggles', region: '<p>one two three</p>',
      run: (_room, A, B) => { A.select(A.find('one'), A.find('two', { after: true })).key('b', { mod: true }); B.select(B.find('two'), B.find('three', { after: true })).key('i', { mod: true }); },
      expected: '<p><strong>one <em>two</em></strong><em> three</em></p>' },
    { name: 'a link edit and a text edit inside the link: the typed text joins the new link', region: '<p>see <a href="https://a.dev">the docs</a> now</p>',
      run: (_room, A, B) => { A.select(A.find('the docs'), A.find('the docs', { after: true })).run(A.commands.link('https://b.dev')); B.select(B.find('the ', { after: true })).type('best '); },
      expected: '<p>see <a href="https://b.dev">the best docs</a> now</p>', kept: ['best'] },
    { name: 'a Google Docs paste: its bold spans are bold, its font-weight:normal <b> wrapper is not', region: '<p>x</p>',
      run: (_room, A) => { A.select(A.blockStart(0, true)).paste('<meta charset="utf-8"><b style="font-weight:normal;" id="docs-internal-guid-0a1b"><p dir="ltr" style="line-height:1.38;"><span style="font-size:11pt;font-weight:700;">Docs bold</span><span style="font-size:11pt;font-weight:400;"> and plain</span><span style="font-style:italic;font-weight:400;"> slanted</span></p><ul><li dir="ltr"><p dir="ltr" role="presentation"><span style="font-size:11pt;">Docs item</span></p></li></ul></b>'); },
      expected: '<p>x<strong>Docs bold</strong> and plain<em> slanted</em></p><ul><li><p>Docs item</p></li></ul>' },
    { name: 'a Google Docs paste of part of a line is not bold for its <b> wrapper', region: '<p>x</p>',
      run: (_room, A) => { A.select(A.blockStart(0)).paste('<meta charset="utf-8"><b style="font-weight:normal;" id="docs-internal-guid-2c3d"><span style="font-size:11pt;">just plain </span><span style="font-weight:700;">bold</span></b>'); },
      expected: '<p>just plain <strong>bold</strong>x</p>' },
    { name: 'a pasted span of normal weight inside bold is not bold', region: '<p>x</p>',
      run: (_room, A) => { A.select(A.blockStart(0, true)).paste('<p><b>bold <span style="font-weight: normal">plain</span></b></p>'); },
      expected: '<p>x<strong>bold </strong>plain</p>' },
    { name: 'a Word paste: <b> and <i> stay, mso spans and <o:p> go', region: '<p>x</p>',
      run: (_room, A) => { A.select(A.blockStart(0, true)).paste('<p class=MsoNormal><span style=\'font-size:12.0pt;mso-bidi-font-weight:normal\'>Word <b>bold</b> and <i>italic</i><o:p></o:p></span></p>'); },
      expected: '<p>xWord <strong>bold</strong> and <em>italic</em></p>' },
    { name: 'a pasted javascript: link is stripped to its text', region: '<p>x</p>',
      run: (_room, A) => { A.select(A.blockStart(0, true)).paste('<a href="javascript:alert(1)" onclick="y()">click</a> <a href=" JAVA\tSCRIPT:x">two</a>'); },
      expected: '<p>xclick two</p>' },
  ]);

  it('the link command refuses a javascript: href', () => {
    const [room, A] = open('<p>x</p>');
    A.select(A.blockStart(0), A.blockStart(0, true));
    expect(A.commands.link('javascript:alert(1)')(A.state, A.view.dispatch)).toBe(false);
    expect(bare(room.invariants())).toBe('<p>x</p>');
  });
});

describe('undo', () => {
  it('each user\'s undo undoes only their own changes', () => {
    const [room, A, B] = open('<p>base</p>');
    A.select(A.blockStart(0, true)).type(' A');
    room.sync();
    B.select(B.blockStart(0, true)).type(' B');
    room.sync();
    A.undo();
    expect(bare(room.invariants())).toBe('<p>base B</p>');
    B.undo();
    expect(bare(room.invariants())).toBe('<p>base</p>');
    A.redo();
    expect(bare(room.invariants())).toBe('<p>base A</p>');
  });

  it('undo after a remote edit inside the same text removes only the undoer\'s characters', () => {
    const [room, A, B] = open('<p>base</p>');
    A.select(A.blockStart(0, true)).type(' hello');
    room.sync();
    B.select(B.find('he', { after: true })).type('XX');
    B.select(B.find('heXXllo'), B.find('heXXllo', { after: true })).key('b', { mod: true });
    room.sync();
    A.undo();
    // A's " hello" goes, its leading space included; B's XX and B's bold on it stay.
    expect(bare(room.invariants())).toBe('<p>base<strong>XX</strong></p>');
  });

  it('undo after compaction brings back a retired id in the live state; the next compaction strips it', () => {
    const [room, A] = open('<p>One</p><p>Two</p>');
    const retired = idsOf(room.html())[1]!;
    A.delete(A.blockStart(1) - 1, A.blockStart(1, true) + 1);
    room.sync();
    room.compact();
    A.undo();
    room.sync();
    expect(room.html()).toContain(`<p data-af-id="${retired}">Two</p>`);
    const page = room.compact();
    expect(page.html).not.toContain(`"${retired}"`);
    expect(bare(room.invariants())).toBe('<p>One</p><p>Two</p>');
  });
});

describe('delivery', () => {
  it('duplicate delivery of the same update is idempotent', () => {
    const [room, A, B] = open('<p>x</p>');
    A.select(A.blockStart(0, true)).type(' once');
    room.send(A);
    room.receive(B, [0, 0, 0]);
    room.receive(A, [0]);
    expect(bare(room.invariants())).toBe('<p>x once</p>');
  });

  it('out-of-order delivery converges', () => {
    const [room, A, B] = open('<p>x</p>');
    A.select(A.blockStart(0, true)).type(' one').key('Enter').type('two').key('Enter').type('three');
    room.send(A);
    room.receive(B, room.log.map((_update, index) => index).reverse());
    expect(B.html()).toBe(A.html());
    expect(bare(room.invariants())).toBe('<p>x one</p><p>two</p><p>three</p>');
  });

  it('one client offline for 200 edits, then reconnecting', () => {
    const [room, A, B] = open('<p>start</p>');
    B.online = false;
    const typed: string[] = [];
    for (let i = 0; i < 100; i++) {
      const a = `a${i}`, b = `b${i}`;
      typed.push(a, b);
      A.select(A.blockStart(A.state.doc.childCount - 1, true)).type(` ${a}`);
      if (i % 10 === 9) A.key('Enter');
      if (i % 25 === 0) A.select(A.blockStart(0), A.blockStart(0) + 2).key('b', { mod: true });
      room.sync();
      B.select(B.blockStart(0)).type(`${b} `);
      if (i % 20 === 19) B.key('Enter');
    }
    B.online = true;
    const html = room.invariants();
    for (const text of typed) expect(html).toMatch(new RegExp(`(?<![\\w])${text}(?![\\d])`));
  });

  it('three clients with partitions that heal', () => {
    const [room, A, B, C] = open('<p>one</p><p>two</p><p>three</p>', ['A', 'B', 'C']);
    C.online = false;
    A.select(A.find('one', { after: true })).type(' A1');
    B.select(B.find('two', { after: true })).type(' B1');
    room.sync();
    C.select(C.find('three', { after: true })).type(' C1');
    A.online = false;
    B.select(B.find('one', { after: true })).type(' B2');
    C.online = true;
    room.sync();
    A.select(A.find('three', { after: true })).type(' A2');
    A.online = true;
    expect(bare(room.invariants())).toBe('<p>one B2 A1</p><p>two B1</p><p>three A2 C1</p>');
  });
});

describe('republish and agent edits (three-way)', () => {
  const base = '<h2>Goals</h2><p>First paragraph about the plan.</p><p>Second paragraph that the author will revise.</p>';

  it('the author changes paragraph 2 while a reader\'s synced, unsaved edits are in paragraphs 1 and 2', () => {
    const [room, A] = open(base);
    A.select(A.find('the plan', { after: true })).type(' [p1]');
    A.select(A.find('Second', { after: true })).type(' [p2]');
    room.sync();
    room.republish((region) => region.replace('Second paragraph that the author will revise.', 'Second paragraph, revised by the author.'));
    expect(bare(room.invariants())).toBe('<h2>Goals</h2><p>First paragraph about the plan [p1].</p><p>Second [p2] paragraph, revised by the author.</p>');
  });

  it('the author deletes a block the reader is typing in: the block goes, the reader\'s synced and unsent typing survive', () => {
    const [room, A] = open(base);
    A.select(A.find('Second', { after: true })).type(' [typed]');
    room.sync();
    A.select(A.find('[typed]', { after: true })).type(' [unsent]');
    room.republish((region) => region.replace(/<p[^>]*>Second[^<]*<\/p>/, ''));
    const html = room.invariants();
    // The author deleted the block, so its line end goes; the reader's characters were never the author's to delete,
    // so they stay where they were typed. The deleted block was the last one, so they read as a paragraph of their
    // own (before another block they would start that block, as when a peer deletes the block: 'moreEnd' above).
    expect(bare(html)).toBe('<h2>Goals</h2><p>First paragraph about the plan.</p><p>[typed] [unsent]</p>');
  });

  it('the author changes p to h2 while a reader types in it: the reader\'s typing stays', () => {
    const [room, A] = open(base);
    A.select(A.find('First', { after: true })).type(' [typed]');
    room.sync();
    A.select(A.find('[typed]', { after: true })).type(' [unsent]');
    room.republish((region) => region.replace(/<p( data-af-id="[^"]+")>First paragraph about the plan.<\/p>/, '<h2$1>First paragraph about the plan.</h2>'));
    expect(bare(room.invariants())).toBe('<h2>Goals</h2><h2>First [typed] [unsent] paragraph about the plan.</h2><p>Second paragraph that the author will revise.</p>');
  });

  it('the author adds blocks while a reader types', () => {
    const [room, A] = open(base);
    A.select(A.find('plan', { after: true })).type(' [typed]');
    room.republish((region) => `${region}<ul><li>New item</li></ul><p>New closing paragraph.</p>`);
    expect(bare(room.invariants())).toBe('<h2>Goals</h2><p>First paragraph about the plan [typed].</p><p>Second paragraph that the author will revise.</p><ul><li><p>New item</p></li></ul><p>New closing paragraph.</p>');
  });

  it('an agent rewrites one section in Markdown while two users type in another', () => {
    const [room, A, B] = open('<h2>Plan</h2><p>Plan text.</p><h2>Notes</h2><p>Notes text.</p>');
    A.select(A.find('Notes text', { after: true })).type(' [A]');
    B.select(B.find('Notes', { nth: 1, after: true })).type(' [B]');
    room.sync();
    room.agent('## Plan\n\nRewritten **by the agent**.\n\n- one\n- two\n\n## Notes\n\nNotes text.\n');
    A.select(A.find('[A]', { after: true })).type('!');
    const html = room.invariants();
    expect(bare(html)).toBe('<h2>Plan</h2><p>Rewritten <strong>by the agent</strong>.</p><ul><li><p>one</p></li><li><p>two</p></li></ul><h2>Notes</h2><p>Notes [B] text [A]!.</p>');
    // The agent's Markdown has no ids: unchanged blocks keep theirs.
    expect(html).toMatch(/<h2 data-af-id="[^"]+">Notes<\/h2><p data-af-id="[^"]+">Notes/);
  });

  it('an agent and a user edit the same sentence', () => {
    const [room, A] = open('<p>The quick brown fox.</p>');
    A.select(A.find('quick', { after: true })).type(' very');
    room.sync();
    room.agent('The quick red fox.');
    expect(bare(room.invariants())).toBe('<p>The quick very red fox.</p>');
  });

  it('a republish without a snapshot is refused, typed, and changes nothing', () => {
    const [room, A] = open(base);
    A.select(A.find('plan', { after: true })).type(' [typed]');
    room.sync();
    room.snapshot = null;
    const before = room.html();
    expect(() => room.republish((region) => region.replace('Goals', 'Aims'))).toThrow(expect.objectContaining({ code: 'missing_snapshot' }));
    expect(() => room.republish((region) => region)).toThrow(LiveRegionRefusal);
    expect(room.html()).toBe(before);
    room.snapshot = room.compact().snapshot;
    expect(bare(room.invariants())).toBe('<h2>Goals</h2><p>First paragraph about the plan [typed].</p><p>Second paragraph that the author will revise.</p>');
  });

  it('two republishes in a row, each against the snapshot the previous one kept, with typing between', () => {
    const [room, A] = open(base);
    A.select(A.find('First', { after: true })).type(' [r1]');
    room.sync();
    room.republish((region) => region.replace('Goals', 'Goals v2'));
    A.select(A.find('Second', { after: true })).type(' [r2]');
    room.sync();
    room.republish((region) => region.replace('about the plan', 'about the new plan'));
    room.compact();
    A.select(A.find('revise', { after: true })).type(' [r3]');
    room.sync();
    room.republish((region) => region.replace('Goals v2', 'Goals v3'));
    expect(bare(room.invariants())).toBe('<h2>Goals v3</h2><p>First [r1] paragraph about the new plan.</p><p>Second [r2] paragraph that the author will revise [r3].</p>');
  });
});

describe('ids', () => {
  it('Enter in the middle: the text after the cursor keeps the block\'s line end and ids, the text before is a new block with a fresh id at compaction', () => {
    const [room, A] = open('<p>Hello world</p>');
    const [id] = idsOf(room.html());
    A.select(A.find('Hello', { after: true })).key('Enter');
    const html = room.invariants();
    expect(html).toBe(`<p>Hello</p><p data-af-id="${id}">world</p>`);
    const page = room.compact();
    const [first, second] = idsOf(room.html());
    expect([second, page.html.includes(`data-af-id="${first}">Hello`)]).toEqual([id, true]);
    expect(first).not.toBe(id);
  });

  it('Enter in the middle, then undo: every id is unchanged in the editor and on the server', () => {
    const [room, A] = open('<h2>Title here</h2><p>next</p>');
    const before = room.html();
    A.select(A.find('Title', { after: true })).key('Enter');
    room.invariants();
    A.undo();
    expect(room.invariants()).toBe(before);
    expect(A.html()).toBe(before);
  });

  it('Enter at the start: an empty block goes before, the text keeps its id', () => {
    const [room, A] = open('<p>Hello</p>');
    const [id] = idsOf(room.html());
    A.select(A.blockStart(0)).key('Enter');
    expect(room.invariants()).toBe(`<p></p><p data-af-id="${id}">Hello</p>`);
  });

  /** Copies blocks `from`..`to` (inclusive) through the editor's own clipboard serializer. */
  const copyBlocks = (client: Client, from: number, to: number) => client.view.serializeForClipboard(client.state.doc.slice(client.blockStart(from) - 1, client.blockStart(to, true) + 1)).dom.innerHTML;

  it('a copy and paste of a block carries its id, which the paste loses; the original keeps it', () => {
    const [room, A] = open('<p>Original</p><p>End</p>');
    const [id] = idsOf(room.html());
    const copied = copyBlocks(A, 0, 0);
    expect(copied).toContain(`data-af-id="${id}"`);
    A.select(A.blockStart(1, true)).key('Enter').paste(copied);
    const html = room.invariants();
    expect(idsOf(html).filter((candidate) => candidate === id)).toHaveLength(1);
    expect(html).toContain(`<p data-af-id="${id}">Original</p>`);
    // A closed block pasted into the empty paragraph replaces it.
    expect(bare(html)).toBe('<p>Original</p><p>End</p><p>Original</p>');
  });

  it('a paste of foreign HTML carrying a live id loses the id', () => {
    const [room, A] = open('<p>Original</p><p>End</p>');
    const [id] = idsOf(room.html());
    A.select(A.blockStart(1, true)).paste(`<p>lead</p><p data-af-id="${id}">Pasted copy</p><p>tail</p>`);
    const html = room.invariants();
    expect(idsOf(html).filter((candidate) => candidate === id)).toHaveLength(1);
    expect(bare(html)).toBe('<p>Original</p><p>Endlead</p><p>Pasted copy</p><p>tail</p>');
  });

  it('a block moved by cut and paste keeps its id', () => {
    const [room, A] = open('<p>Mover</p><p>Stay</p>');
    const [id] = idsOf(room.html());
    const copied = copyBlocks(A, 0, 0);
    A.delete(A.blockStart(0) - 1, A.blockStart(0, true) + 1);
    A.select(A.blockStart(0, true)).key('Enter').paste(copied);
    const html = room.invariants();
    expect(bare(html)).toBe('<p>Stay</p><p>Mover</p>');
    expect(html).toContain(`<p data-af-id="${id}">Mover</p>`);
  });

  it('editing a bold run through the editor keeps the paragraph id, and no inline element gains one at compaction', () => {
    const [room, A] = open('<p>Hello <strong>bold</strong> text</p>');
    expect(room.page.html).toMatch(/Hello <strong>bold<\/strong> text/);
    const [paragraph] = idsOf(room.html());
    A.select(A.find('bold'), A.find('bold', { after: true })).type('rewritten');
    room.sync();
    const page = room.compact();
    expect(page.html).toContain(`<p data-af-id="${paragraph}">Hello <strong>rewritten</strong> text</p>`);
    expect(bare(room.invariants())).toBe('<p>Hello <strong>rewritten</strong> text</p>');
  });

  it('Backspace-join keeps the first paragraph\'s id; the second paragraph\'s id retires at compaction', () => {
    const [room, A] = open('<p>First</p><p>Second</p>');
    const [first, second] = idsOf(room.html());
    A.select(A.blockStart(1)).key('Backspace');
    expect(room.invariants()).toBe(`<p data-af-id="${first}">FirstSecond</p>`);
    const page = room.compact();
    expect(page.ledger.allocatedIds).toContain(second);
    expect(page.html).not.toContain(`"${second}"`);
  });
});

describe('sanitization through the editor', () => {
  runScenarios([
    { name: 'a paste of report-like HTML keeps only schema content', region: '<p>x</p>',
      run: (_room, A) => {
        A.select(A.blockStart(0, true)).paste('<div class="card" onclick="steal()"><h3 style="color:red">Title</h3><svg><text>chart label</text></svg><button>Buy</button><p>Body <b>bold</b> <i>it</i> <span class="pill">pill</span></p><script>alert(1)</script><img src="x" onerror="y()"></div>');
      },
      // An open paste: its first block's text joins the paragraph at the cursor, as ProseMirror pastes any HTML.
      expected: '<p>xTitle</p><p>Body <strong>bold</strong> <em>it</em> pill</p>' },
  ]);

  it('normalization is the same through the browser parser as through the server parser', () => {
    const corpus = [
      '<h2>Notes &amp; plans</h2><p>Text with <b>bold</b>, <i>italic</i>, <a href="https://x.dev">link</a> and <code>code</code>.</p><ul><li>Bare li</li><li><p>Para li</p><ol><li>Nested</li></ol></li></ul><blockquote><p>Quote</p></blockquote><pre><code>let x = 1;\n  y</code></pre><hr>',
      '<p>a &amp; b &lt; c&nbsp;d 👩🏽‍💻 é</p><ul><li><ul><li>deep</li></ul></li></ul>',
    ];
    const [, A] = open('<p>z</p>');
    const parser = A.view.someProp('clipboardParser')!;
    for (const html of corpus) {
      const dom = document.createElement('div');
      dom.innerHTML = html;
      expect(writeRegion('rich', parser.parse(dom))).toBe(normalizeRegionHtml('rich', html));
    }
  });

  it('a page published from a compacted editor region is accepted as is', () => {
    const [room, A] = open('<p>x</p>');
    A.select(A.blockStart(0, true)).type(' **bold** and *it* and `code`').key('Enter').type('# Heading');
    room.sync();
    const page = room.compact();
    expect(() => canonicalizeHtmlPage(page.html, { previousHtml: page.html, ledger: page.ledger })).not.toThrow();
    expect(bare(room.invariants())).toBe('<p>x <strong>bold</strong> and <em>it</em> and <code>code</code></p><h1>Heading</h1>');
  });
});
