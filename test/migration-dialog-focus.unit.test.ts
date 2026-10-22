import { test } from "node:test";
import assert from "node:assert/strict";
import { scheduleDialogOpeningFocus } from "../src/migration/conversion/compiled/dialog-focus.ts";
test("deferred modal autofocus respects reader focus and retired openings", () => {
  for (const mode of ["unchanged", "reader-moved", "closed", "retired"]) {
    const initial = {} as Element,
      moved = {} as Element;
    let active = initial,
      open = true,
      focused = 0,
      frame!: () => void;
    const stop = scheduleDialogOpeningFocus({
      schedule: (callback) => {
        frame = callback;
      },
      activeElement: () => active,
      isOpen: () => open,
      focusInitial: () => {
        focused++;
      },
    });
    if (mode === "reader-moved") active = moved;
    if (mode === "closed") open = false;
    if (mode === "retired") stop();
    frame();
    assert.equal(focused, mode === "unchanged" ? 1 : 0);
  }
});

import { admitLocalSource } from "../src/migration/conversion/compiled/source-admission.ts";
test("only source Dialog requests the audited focus runtime graph", () => {
  const admitted = admitLocalSource({
    coreUrl: "/af/v1/core.js",
    source:
      '<Dialog id="d"><DialogTrigger id="t">Open</DialogTrigger><DialogContent id="c"><p id="p">Body</p></DialogContent></Dialog>',
  });
  assert.equal(admitted.ok, true);
  if (admitted.ok) assert.equal(admitted.plan.input.dialogFocus, true);
  const staticPage = admitLocalSource({
    coreUrl: "/af/v1/core.js",
    source: '<p id="p">Body</p>',
    dialogFocus: true,
  });
  assert.equal(staticPage.ok, true);
  if (staticPage.ok) assert.equal(staticPage.plan.input.dialogFocus, false);
});
