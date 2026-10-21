import test from "node:test";
import assert from "node:assert/strict";
import type { SharedFile } from "../src/contracts.ts";
import type {
  SourceHeader,
  SourceReadContext,
} from "../src/server/source-repository-contracts.ts";
// These compile-time assertions protect the absence of projection/sentinel states.
function contracts(header: SourceHeader, context: SourceReadContext) {
  // @ts-expect-error A source header is not a fabricated complete document.
  const file: SharedFile = header;
  // @ts-expect-error Loaded sources always contain their immutable content.
  const unloaded: SourceReadContext = { ...context, source: { revision: "r" } };
  // @ts-expect-error Reads cannot request a content-loading sentinel.
  const flag: SourceReadContext = { ...context, sourceContent: false };
  return { file, unloaded, flag };
}
test("source contracts have no partial-document or unloaded-content variants", () => {
  assert.equal(typeof contracts, "function");
});
