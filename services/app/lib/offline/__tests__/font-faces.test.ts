import { describe, expect, it } from 'vitest';
import { unicodeRanges, withoutUnusedFaces } from '../font-faces';

const LATIN = '@font-face{font-family:"Inter";src:url(/fonts/a.woff2);unicode-range:U+0000-00FF,U+0131}';
const EXT = '@font-face{font-family:"Inter";src:url(/fonts/b.woff2);unicode-range:U+0100-02BA,U+1E??}';
const ALL = '@font-face{font-family:"Mono";src:url(/fonts/c.woff2)}';
const CSS = `${LATIN}${EXT}${ALL}body{color:red}`;

describe('withoutUnusedFaces', () => {
  it('drops a subset no character of the text reaches, keeping faces without a range and every other rule', () => {
    expect(withoutUnusedFaces(CSS, 'Plain ASCII text')).toBe(`${LATIN}${ALL}body{color:red}`);
  });
  it('keeps a subset one character reaches, wildcards included', () => {
    expect(withoutUnusedFaces(CSS, 'Łódź')).toBe(CSS);
    expect(withoutUnusedFaces(CSS, 'Straße ẞ')).toBe(CSS);
  });
  it('reads single points, spans and wildcards', () => {
    expect(unicodeRanges('U+0131, U+0100-02BA,U+1E??')).toEqual([[0x131, 0x131], [0x100, 0x2ba], [0x1e00, 0x1eff]]);
  });
});
