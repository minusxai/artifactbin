import assert from "node:assert/strict";
import test from "node:test";
import { readLegacyFileUploadSites } from "../src/migration/conversion/compiled/file-upload-source.ts";
const source = (upload: string, values = '<Value name="files" type="string"/><Value name="busy" type="boolean"/>') => `<Import name="images" ref="fixture"/>${values}${upload}`;
test("upload grammar resolves literal Import, typed Value/busy and exact disabled signal", () => {
  const sites = readLegacyFileUploadSites(source('<FileUpload dataset="images" value="$files" busy="$busy" multiple maxFiles={5} accept="image/png,image/jpeg,image/webp" disabled={$locked} label="Attachments"/>'));
  assert.deepEqual(sites, [{ bindingName: "images", valueName: "files", busyName: "busy", disabledSignal: "$locked", multiple: true, maxFiles: 5, acceptedTypes: ["image/png", "image/jpeg", "image/webp"] }]);
});
test("upload scope refuses missing Import, wrong Value/busy type and executable expressions", () => {
  for (const tag of [
    '<FileUpload dataset="missing" value="$files" accept="image/png"/>',
    '<FileUpload dataset="images" value="$busy" accept="image/png"/>',
    '<FileUpload dataset="images" value="$files" busy="$files" accept="image/png"/>',
    '<FileUpload dataset="images" value="$files" disabled={run()} accept="image/png"/>',
    '<FileUpload dataset="images" value="$files" maxFiles={Infinity} accept="image/png"/>',
    '<FileUpload dataset="images" value="$files" accept="image/*"/>',
    '<FileUpload dataset="images" value="$files" {...props} accept="image/png"/>',
  ]) assert.throws(() => readLegacyFileUploadSites(source(tag)), /unsupported/i);
});
test("upload detection does not widen refusals for unrelated dynamic Values", () => {
  assert.deepEqual(readLegacyFileUploadSites('<Value name="other" default={dynamic()}/>'), []);
  assert.equal(readLegacyFileUploadSites(source('<FileUpload dataset="images" value="$files" accept="image/png"/>', '<Value name="files"/><Value name="other" default={dynamic()}/>')).length, 1);
});
