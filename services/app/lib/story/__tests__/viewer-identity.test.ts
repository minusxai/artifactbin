/**
 * WHO IS VIEWING, IN MARKUP. `$_me` is the viewer's account id and null for a
 * guest, but only SQL could read it: a page could not show a form to signed-in
 * people and a prompt to guests without a script and a flag that stuck in the link.
 * It is readable in conditions, never bindable, and two kit components exist to
 * show a person and to ask a guest to sign in.
 */
import { describe, expect, it } from 'vitest';
import { type JsxNode } from '@/lib/jsx';
import { collectRefNameUses, parseValueDecl, validateDataflow, type Dataflow } from '@/lib/story/dataflow';
import { PERSON_TAGS, STORY_UI_COMPONENT_NAME_LIST } from '@/lib/story-ui/component-names';
import { STORY_UI_COMPONENTS } from '@/lib/story-ui/registry';
import { validateJsxSource } from '@/lib/jsx';
import { JSX_STORY_COMPONENT_NAMES } from '@/lib/jsx/components';
import { STORY_HTML_TAGS } from '@/lib/story-ui/component-names';
import { parseJsxOrThrow } from '@/test/helpers/jsx';
import { validateMarkupStructure } from '@/lib/story/local-validation';

const nodes = (source: string): JsxNode[] => parseJsxOrThrow(source).nodes;
const EMPTY: Dataflow = { imports: [], values: [], queries: [], mutations: [] };
const errors = (source: string) => validateDataflow(EMPTY, collectRefNameUses(nodes(source))).map((e) => e.message);

describe('$_me in markup', () => {
  it('is readable in a condition without being declared', () => {
    expect(errors('{$_me.id ? <p>in</p> : <p>out</p>}')).toEqual([]);
    expect(errors('{!$_me.id && <p>guest</p>}')).toEqual([]);
  });

  it('is never bindable: a control cannot write the viewer', () => {
    expect(errors('<input aria-label="Who" value="$_me.id" />').join(' ')).toMatch(/_me/);
    expect(errors('<Dialog open="$_me.id"><DialogContent aria-label="x"><p>x</p></DialogContent></Dialog>').join(' ')).toMatch(/_me/);
  });

  it('still cannot be declared by an author', () => {
    const declared = parseValueDecl(nodes('<Value name="_me" type="string" />')[0] as never);
    expect(declared.ok).toBe(false);
  });
});

describe('the kit can show a person and ask a guest to sign in', () => {
  it('registers every person tag and SignIn as author components', () => {
    for (const name of ['User', 'UserImage', 'UserHandle', 'SignIn']) {
      expect(STORY_UI_COMPONENT_NAME_LIST).toContain(name);
      expect(Object.keys(STORY_UI_COMPONENTS)).toContain(name);
    }
    // The person component list and the vocabulary must name the same tags:
    // a tag inside the set but outside the list could never be authored, and a
    // person tag outside the set would be missing from the author vocabulary.
    for (const tag of PERSON_TAGS) expect(STORY_UI_COMPONENT_NAME_LIST).toContain(tag);
  });

  it('accepts them at publish', () => {
    const source = '<div data-design="tw">{$_me.id ? <p>Paid by <User userId="$_me.id" /></p> : <SignIn>Sign in to add an expense</SignIn>}</div>';
    expect(validateJsxSource(source, JSX_STORY_COMPONENT_NAMES, STORY_HTML_TAGS, 'no-inline-style')).toEqual([]);
    const halves = '<div data-design="tw"><UserImage userId="$_me.id" size="lg" /><UserHandle userId="$_me.id" /></div>';
    expect(validateJsxSource(halves, JSX_STORY_COMPONENT_NAMES, STORY_HTML_TAGS, 'no-inline-style')).toEqual([]);
  });
});

/**
 * THE PUBLISH DOOR, not just the unit. `validateDataflow` above is the rule;
 * this is the door every write goes through (lib/story/local-validation, which
 * /api/preview and publish share), so a refusal proved in one is the refusal an
 * author actually gets.
 */
describe('the publish door', () => {
  const refusals = (source: string) => validateMarkupStructure(source).errors.map((e) => e.message);

  it('accepts reading the viewer and refuses binding or declaring it', () => {
    expect(refusals('<div>{$_me.id ? <p>in</p> : <SignIn>Join</SignIn>}</div>')).toEqual([]);
    expect(refusals('<div><User userId="$_me.id" /></div>')).toEqual([]);
    // `userId` on a person tag READS its reference; the face and the handle are the
    // same read-only position as the composition of the two.
    expect(refusals('<div><UserImage userId="$_me.id" /><UserHandle userId="$_me.id" /></div>')).toEqual([]);
    expect(refusals('<div><input aria-label="Who" value="$_me.id" /></div>').join(' ')).toMatch(/\$_me/);
    expect(refusals('<Helmet><Value name="_me" type="user" /></Helmet><p>x</p>').join(' ')).toMatch(/_me/);
  });

  it('still refuses a typo that only LOOKS like the viewer', () => {
    expect(refusals('<div>{$_mee ? <p>in</p> : <p>out</p>}</div>').join(' ')).toMatch(/_mee/);
  });
});
