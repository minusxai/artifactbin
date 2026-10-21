import assert from "node:assert/strict";
import { encodeRuntime } from "./packaging.mjs";
const source =
  'const scriptVariable=3; globalThis.result={operator:1<scriptVariable, strings:["<!--","</script>","<script>","\\x15","\\x85","🪴","\\\\<"], template:`a${2}<script> \\` \\${literal}`, raw:String.raw`safe\\nvalue`};';
const evaluate = (code) => {
  const scope = {};
  Function("globalThis", code)(scope);
  return scope.result;
};
const encoded = encodeRuntime(source);
assert.deepEqual(evaluate(encoded), evaluate(source));
assert.ok(encoded.includes("1<scriptVariable"));
assert.ok(!encoded.includes("<!--"));
assert.ok(!encoded.includes("</script>"));
assert.throws(
  () => encodeRuntime("globalThis.x=String.raw`<script>`"),
  /unsupported raw/,
);
const regexSource =
  'const regex=/^<!--/gy;globalThis.result={source:regex.source,flags:regex.flags,match:regex.test("<!--"),index:regex.lastIndex};';
assert.deepEqual(evaluate(encodeRuntime(regexSource)), evaluate(regexSource));
const escapedDirective =
  '"\\x75se strict";globalThis.result=(function(){return this===undefined})();';
assert.equal(
  evaluate(encodeRuntime(escapedDirective)),
  evaluate(escapedDirective),
);
assert.throws(() => encodeRuntime("const ="), SyntaxError);
console.log("AST runtime packaging behavior tests passed");
