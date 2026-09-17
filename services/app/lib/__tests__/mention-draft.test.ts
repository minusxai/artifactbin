import { describe, expect, it } from 'vitest';
import { mentionDraft } from '../mention-draft';

const first = '[@Claude](/chat?session=7d545566-1a47-4aaf-be61-cffcb7b8e8f2)';
const second = '[@Claude](/chat?session=7d545566-1a47-4aaf-be61-cffcb7b8e8f3)';
describe('mention drafts', () => {
  it('hides IDs and preserves them when writing before or after a mention', () => {
    expect(mentionDraft(first).text).toBe('@Claude');
    expect(mentionDraft(first).edit('@Claude please', 14)).toBe(`${first} please`);
    expect(mentionDraft(first).edit('Hi @Claude', 3)).toBe(`Hi ${first}`);
  });
  it('keeps duplicate labels linked to their own sessions', () => {
    const draft = mentionDraft(`${first} ${second}`);
    expect(draft.edit('@Claude', 0)).toBe(second);
    expect(draft.edit('@Claude', 7)).toBe(first);
  });
  it('removes the hidden ID when a name is edited or deleted', () => {
    expect(mentionDraft(first).edit('@Claud', 6)).toBe('@Claud');
    expect(mentionDraft(first).edit('@ClaXude', 5)).toBe('@ClaXude');
    expect(mentionDraft(first).edit('', 0)).toBe('');
  });
  it('maps formatting selections and the caret after an inserted mention', () => {
    const draft = mentionDraft(`hi ${first} there`);
    expect(draft.toRaw(3)).toBe(3);
    expect(draft.toRaw(10, 'end')).toBe(3 + first.length);
    expect(draft.toDisplay(3 + first.length + 1)).toBe(11);
  });
  it('preserves Markdown and multiline text surrounding mentions', () => {
    const raw = `**hello**\n${first}\nbye`;
    expect(mentionDraft(raw).edit('**hello**\n@Claude\nbye!', 23)).toBe(`${raw}!`);
  });
});
