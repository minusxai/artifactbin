import { test } from "node:test";
import assert from "node:assert/strict";
import { previewOverride, resolveAppearance, withPreview } from "../../../src/browser/core/appearance.ts";

const viewer = { designSystem: "riso", dark: false };

test("a preview query forces dark mode and a design system over the viewer's and the page's", () => {
  const preview = previewOverride("?af-dark=1&af-design-system=dossier");
  assert.deepEqual(preview, { designSystem: "dossier", dark: true });
  const picks = withPreview(viewer, preview);
  assert.deepEqual(
    resolveAppearance({ pageDesignSystem: "volta", viewerDesignSystem: picks.designSystem, viewerDark: picks.dark, systemDark: false }),
    { designSystem: "dossier", dark: true },
  );
  assert.deepEqual(previewOverride("?af-dark=0"), { designSystem: null, dark: false });
});

test("without a preview query, or with unknown values, nothing is forced", () => {
  for (const search of ["", "?other=1", "?af-dark=yes&af-design-system=nope"]) {
    const preview = previewOverride(search);
    assert.deepEqual(preview, { designSystem: null, dark: null }, search);
    assert.deepEqual(withPreview(viewer, preview), viewer);
  }
});
