/**
 * AN APP SEVERAL PEOPLE USE. An agent asked for "a shared tracker for my friends" built on
 * typed names and a fake person, and handed over writes it had never run. The skill now says,
 * on its first page, where to look when a request is about several people, and that a push
 * does not verify a write. The reference it points at teaches only shapes the door accepts.
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { buildQuickSheet } from '@/test/helpers/skill-docs';
import { validateMarkupStructure } from '@/lib/document/local-validation';

const sheet = buildQuickSheet('https://artifactbin.dev');
const REFERENCE = path.resolve(process.cwd(), 'skills/artifactbin/references/apps.md');
const reference = () => readFileSync(REFERENCE, 'utf8');
const fences = (text: string) => [...text.matchAll(/```jsx\n([\s\S]*?)```/g)].map((m) => m[1]);

describe('the skill’s first page', () => {
  const bullets = sheet.split('\n').filter((line) => line.startsWith('- '));

  it('sends a request about several people to the apps reference before a data shape is chosen', () => {
    const trigger = bullets.find((b) => b.includes('(references/apps.md)'));
    expect(trigger).toBeDefined();
    for (const word of ['shared', 'friends', 'team']) expect(trigger!.toLowerCase()).toContain(word);
  });

  it('keeps the measured rule for documents, and says a push does not verify a write', () => {
    expect(sheet).toContain('Push confirms source acceptance');
    expect(sheet).toContain('Sessions are browser/UI QA for newly authored or changed `<Mutation>`');
    const writes = bullets.find((b) => b.includes('<Mutation>') && /live session/i.test(b));
    expect(writes).toBeDefined();
    expect(writes).toContain('--as guest');
    expect(writes).toContain('(references/live-sessions.md)');
  });
});

describe('references/apps.md', () => {
  it('teaches accounts, the viewer, the sign-in door, and a form that stays out of the link', () => {
    const text = reference();
    for (const shape of ['$_me', '<User', '_members', 'artifactOwner', 'afbin invite', 'afbin mention']) expect(text, shape).toContain(shape);
    expect(text).not.toMatch(/"name":\s*"Me"/);
  });

  /**
   * THE REALISM GAP. A test user verifies a COPY, and an agent that never reads that sentence
   * hands over "artifact abc123 works for two people" when what it ran was a fork of it. The
   * workflow is only safe to teach while the limit of what it proves is taught beside it.
   */
  it('teaches the whole test-user workflow in order, and what a pass with one does NOT prove', () => {
    const text = reference();
    const at = (needle: string | RegExp) => {
      const index = typeof needle === 'string' ? text.indexOf(needle) : text.search(needle);
      expect(index, String(needle)).toBeGreaterThan(-1);
      return index;
    };
    // Mint, give the copy away, browse as that person, erase — in that order.
    let previous = -1;
    for (const step of ['afbin testuser new', 'afbin fork abc123 --as tu_', 'afbin sessions script new --as tu_', 'afbin testuser delete tu_']) {
      expect(at(step), step).toBeGreaterThan(previous);
      previous = at(step);
    }
    // Each identity tests its own authorized disposable copy.
    expect(text).toContain('afbin fork abc123 --json');
    expect(text).toContain('A path-only result is an unpublished local draft');
    expect(text).toContain('replace its Import references');
    expect(text).toContain('Never fall back to testing writes on the original');
    expect(text).toMatch(/afbin sessions script new --input [^\n]*# you, on your own copy/);
    // The gap itself: a COPY, what a clean pass proves, and that nothing reaches the original.
    expect(text).toMatch(/A test user verifies a COPY/);
    expect(text).toMatch(/never that `abc123` works/);
    expect(text).toMatch(/nothing a test user does reaches\s+the original/);
    // And the refusal that stops an agent pressing Join on the real page instead of forking.
    expect(at('sandbox_only')).toBeGreaterThan(at('A test user verifies a COPY'));
  });

  it('teaches only markup the publish door accepts', () => {
    const blocks = fences(reference()).filter((block) => block.includes('<Helmet>'));
    expect(blocks.length).toBeGreaterThan(0);
    for (const block of blocks) expect(validateMarkupStructure(block).errors.map((e) => e.message)).toEqual([]);
  });
});

it('keeps successful test writes on authorized copies and explains the mutation read boundary',()=>{
 const text=reference();
 expect(text).toContain('Run each write on that identity’s authorized disposable copy');
 expect(text).toContain('`$_me.id` writes must stay disabled and change no data');
 // The compiler and the write door load a mutation's other imports and `_members`; a query result is an argument.
 expect(text).toContain('A Mutation may read other imports and `_members`');
 expect(text).toContain('never a\nquery: pass a query\'s value in as an argument');
});

it('teaches accepted platform membership without custom join tables',()=>{
 const text=reference();
 expect(text).not.toContain('_likes');
 expect(text).toContain('select user_id, joined_at from _members');
 expect(text).not.toContain('insert into public.members');
 expect(text).toContain('afbin members');
});

/**
 * ONE SESSION AT A TIME, AND A STOP. A server runs two browser sessions by default, shared by everyone, and the skill
 * taught comparing views by opening sessions as yourself, a test user and a guest — three at once, so
 * the third create was refused. And "fix and push until clean" kept agents re-testing a tracker that
 * already worked until the turn cap. Each identity is its own session, closed before the next, and a
 * write seen working once per identity is done.
 */
describe('testing identities in live sessions', () => {
  const live = () => readFileSync(path.resolve(process.cwd(), 'skills/artifactbin/references/live-sessions.md'), 'utf8');
  const shell = (text: string) => [...text.matchAll(/```sh\n([\s\S]*?)```/g)].map((m) => m[1]!);

  it('never holds two sessions open in a taught command sequence', () => {
    const example = readFileSync(path.resolve(process.cwd(), 'skills/artifactbin/references/markup-data-example.md'), 'utf8');
    for (const block of [...shell(reference()), ...shell(example)]) {
      let open = 0;
      for (const line of block.split('\n')) {
        if (/afbin sessions script new\b/.test(line)) open += 1;
        if (/afbin sessions close\b/.test(line)) open -= 1;
        expect(open, block).toBeLessThanOrEqual(1);
      }
    }
  });

  it('teaches the sequence, the capacity refusal, and when to stop', () => {
    const text = live();
    expect(text).toContain('Hold one session at a time');
    expect(text).toMatch(/runs two by default, shared by everyone/);
    expect(text).toContain('SESSION_CAPACITY');
    expect(text).toContain('SESSION_ACTOR_CAPACITY');
    expect(text).not.toMatch(/Compare views by\s+opening sessions as yourself/);
    expect(text).not.toContain('until both passes are clean');
    expect(text).toContain('Stop once each `<Mutation>` has worked once per identity');
  });

  it('checks inner reader surfaces and the visible phone screenshot, not only the document root', () => {
    const text = live();
    expect(text).toContain("document.querySelectorAll('.mx-doc')");
    expect(text).toContain("document.querySelectorAll('[data-design]')");
    expect(text).toContain('document.documentElement.clientWidth');
    expect(text).toContain('Inspect the full-page screenshot at the actual long label and adjacent numeral');
  });

  it('carries the same rule on the skill’s first page', () => {
    const writes = sheet.split('\n').find((b) => b.startsWith('- ') && b.includes('<Mutation>') && /live session/i.test(b))!;
    expect(writes).toContain('One session at a time');
    expect(writes).toContain('Stop once each works once per identity');
    expect(writes).not.toContain('until clean');
  });
});

it('teaches the Riso fact-list selector contract with semantic dt/dd markup',()=>{
 const text=readFileSync(path.resolve(process.cwd(),'skills/artifactbin/references/system-riso.md'),'utf8');
 expect(text).toContain('The compact fact list uses `<dl className="ri-dl">');
 expect(text).toContain('<dt>Count</dt><dd><Number data="$totals" col="bikes" /></dd></dl>');
 expect(text).toContain('runtime rules target `dt`/`dd`, not generic `div`/`span` wrappers');
 expect(text).toContain('avoid 40px `t-numeral` in this list');
 expect(text).not.toContain('<div className="ri-dl">');
});
