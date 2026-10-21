import { test } from "node:test";
import assert from "node:assert/strict";
import { runInNewContext } from "node:vm";
import { encodeRuntime } from "../scripts/encode-runtime.js";

test("large runtime preserves adjacent edits, templates, directives and executable suffixes", () => {
  const values = Array.from(
    { length: 3000 },
    (_, i) => `${i}: </script> café 🪴 \\ \" \` \${value}`,
  );
  const source = `'use strict';globalThis.values=[${values.map(JSON.stringify).join(",")}];globalThis.template=\`café \${values[0]} fin\`;globalThis.raw=String.raw\`plain\\nraw\`;globalThis.suffix=values.length;`;
  const encoded = encodeRuntime(source);
  assert.ok(!encoded.includes("</script>"));
  assert.ok(encoded.startsWith("'use strict';"));
  const context = {};
  runInNewContext(encoded, context);
  assert.deepEqual(Array.from(context.values), values);
  assert.equal(context.template, `café ${values[0]} fin`);
  assert.equal(context.raw, "plain\\nraw");
  assert.equal(context.suffix, 3000);
  assert.equal(encodeRuntime(encoded), encoded);
});
