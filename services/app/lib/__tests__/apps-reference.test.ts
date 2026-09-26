/**
 * AN APP SEVERAL PEOPLE USE. An agent asked for "a shared tracker for my friends" built on
 * typed names and a fake person, and handed over writes it had never run. The skill now says,
 * on its first page, where to look when a request is about several people, and that a push
 * does not verify a write. The reference it points at teaches only shapes the door accepts.
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { buildQuickSheet } from '../skills';
import { validateMarkupStructure } from '@/lib/story/local-validation';

const sheet = buildQuickSheet('https://artifactbin.dev');
const REFERENCE = path.resolve(process.cwd(), 'skills/artifactbin/references/apps.md');
const reference = () => readFileSync(REFERENCE, 'utf8');
const fences = (text: string) => [...text.matchAll(/```jsx\n([\s\S]*?)```/g)].map((m) => m[1]);

describe('the skill’s first page', () => {
  const bullets = sheet.split('\n').filter((line) => line.startsWith('- '));

  it('sends a request about several people to the apps reference before a data shape is chosen', () => {
    const trigger = bullets.find((b) => b.includes('afbin help apps'));
    expect(trigger).toBeDefined();
    for (const word of ['shared', 'friends', 'team']) expect(trigger!.toLowerCase()).toContain(word);
  });

  it('keeps the measured rule for documents, and says a push does not verify a write', () => {
    expect(sheet).toContain('A successful push IS the verification');
    const writes = bullets.find((b) => b.includes('<Mutation>') && /live session/i.test(b));
    expect(writes).toBeDefined();
    expect(writes).toContain('--as guest');
    expect(writes).toMatch(/afbin help live-sessions/);
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
    // A second session, as yourself, on the same copy: two people need two browsers.
    expect(text).toMatch(/afbin sessions script new --input [^\n]*# you/);
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

it('keeps successful test writes on the test-user fork and explains the mutation read boundary',()=>{
 const text=reference();
 expect(text).toContain('Run each write on the test-user fork');
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
