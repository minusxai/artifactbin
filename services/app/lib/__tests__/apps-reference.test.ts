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
    for (const shape of ['$_me', '<User', '<SignIn', 'url={false}', 'reset="', '"type":"user"', '--policy viewers-write']) expect(text, shape).toContain(shape);
    expect(text).not.toMatch(/"name":\s*"Me"/);
  });

  it('teaches only markup the publish door accepts', () => {
    const blocks = fences(reference()).filter((block) => block.includes('<Helmet>'));
    expect(blocks.length).toBeGreaterThan(0);
    for (const block of blocks) expect(validateMarkupStructure(block).errors.map((e) => e.message)).toEqual([]);
  });
});
