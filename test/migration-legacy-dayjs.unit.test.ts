import test from "node:test";
import assert from "node:assert/strict";
import { inlineLegacyDayjs, LEGACY_DAYJS_SHA256 } from "../src/migration/conversion/compiled/legacy-dayjs.ts";
test("one exact classic dayjs frame dependency becomes a pinned lexical library while other versions remain unchanged", async () => {
  const src = 'https://cdnjs.cloudflare.com/ajax/libs/dayjs/1.11.13/dayjs.min.js';
  const input = '<Iframe><script src="'+src+'" id="library"/><script>{`dayjs("2026-01-02").format("YYYY")`}</script></Iframe>';
  const result = await inlineLegacyDayjs(input);
  assert.equal(result.dayjs?.sourceSha256, LEGACY_DAYJS_SHA256);
  assert.match(result.source, /const dayjs=/);
  assert.doesNotMatch(result.source, /src=/);
  assert.match(result.source, /id=\{"library"\}/);
  for (const other of [input.replace("1.11.13","1.11.23"), '<script src="'+src+'"/>', '<Iframe><script src="'+src+'" integrity="custom"/></Iframe>'])
    assert.equal((await inlineLegacyDayjs(other)).source,other);
});
