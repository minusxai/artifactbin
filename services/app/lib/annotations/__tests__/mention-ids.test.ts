/**
 * THE SERVER'S MENTION SCAN on lib/markdown's parser: which people a saved comment body invites. `TODAY` is what the
 * scan answered on its own parser (lib/annotations/markdown-lite, measured before it was deleted, each list made
 * unique as invitePeople reads it); every fixture keeps that answer except the `CHANGED` ones, where the scan now reads
 * exactly the links the thread shows as mentions: an `_` in an id like `usr_bo` no longer hides one (today's parser
 * read it as an italic marker), reference, angle-bracket and titled links are links (today's parser knew only the
 * plain form), and image syntax and indented code are an image and code, not mentions.
 */
import { describe, expect, it } from 'vitest';
import { mentionIds } from '../mention-ids';

const SESSION = '/chat?session=7d545566-1a47-4aaf-be61-cffcb7b8e8f2';
const TODAY: Array<[string, string[]]> = [
  ['[@asha](/api/people/usr_asha) hi', ['usr_asha']],
  ['ask [@bo](/people/usr_bo) and [@asha](/api/people/usr_asha)', ['usr_bo', 'usr_asha']],
  ['***[@asha](/people/usr_asha)***', ['usr_asha']],
  ['`[@asha](/people/usr_asha)`', []],
  ['```\n[@asha](/people/usr_asha)\n```', []],
  ['- [@asha](/people/usr_asha)\n- [@bo](/people/usr_bo)', ['usr_asha', 'usr_bo']],
  ['1. [@asha](/people/usr_asha)\n   - [@bo](/people/usr_bo)', ['usr_asha', 'usr_bo']],
  ['> [@asha](/people/usr_asha)\n> > [@bo](/people/usr_bo)', ['usr_asha', 'usr_bo']],
  ['## Hey [@asha](/people/usr_asha)', ['usr_asha']],
  ['| who | why |\n| --- | --- |\n| [@asha](/people/usr_asha) | review |', ['usr_asha']],
  ['\\[@asha](/people/usr_asha)', []],
  [`[@chat](${SESSION}) and [@asha](/people/usr_asha)`, ['usr_asha']],
  ['[@x](https://evil.example/people/usr_x)', []],
  ['[@asha](/people/usr_asha) [@bo](/people/usr_bo) [@asha](/people/usr_asha)', ['usr_asha', 'usr_bo']],
  ['[@bad](/people/usr bad)', []],
  ['hi\n[@asha](/people/usr_asha)\nbye', ['usr_asha']],
  ['<b>[@asha](/people/usr_asha)</b>', ['usr_asha']],
  ['[[@asha](/people/usr_asha)](https://example.com)', ['usr_asha']],
  ['[`@asha`](/people/usr_asha)', ['usr_asha']],
  ['no mentions here, just @asha typed', []],
  ['', []],
];
const CHANGED: Array<[string, string[], string[]]> = [
  ['**[@asha](/people/usr_asha)** and _see [@bo](/people/usr_bo)_', ['usr_asha'], ['usr_asha', 'usr_bo']],
  ['snake_case [@asha](/people/usr_asha) other_name', [], ['usr_asha']],
  ['[@a][1]\n\n[1]: /people/usr_a', [], ['usr_a']],
  ['[@a](</people/usr_a>)', [], ['usr_a']],
  ['[@a](/people/usr_a "title")', [], ['usr_a']],
  ['![@cy](/people/usr_cy)', ['usr_cy'], []],
  ['    [@a](/people/usr_a)', ['usr_a'], []],
];

describe('the people a comment body mentions', () => {
  it.each(TODAY)('%j: as today', (body, ids) => {
    expect(mentionIds(body)).toEqual(ids);
  });
  it.each(CHANGED)('%j: was %j, now %j (the links the thread shows as mentions)', (body, _today, ids) => {
    expect(mentionIds(body)).toEqual(ids);
  });
  it('finds a mention in a task item and a heading', () => {
    expect(mentionIds('- [ ] ask [@asha](/people/usr_asha)\n\n# [@bo](/people/usr_bo)')).toEqual(['usr_asha', 'usr_bo']);
  });
});
