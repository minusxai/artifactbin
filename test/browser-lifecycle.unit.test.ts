import test from "node:test";
import assert from "node:assert/strict";
import { publicationGate } from "../src/browser/lifecycle.ts";
test("history invalidates pending work and resuming never reauthorizes old epochs", () => {
  const gate = publicationGate();
  const before = gate.epoch;
  assert.equal(gate.accepts(before), true);
  gate.suspend();
  assert.equal(gate.accepts(before), false);
  assert.equal(gate.accepts(gate.epoch), false);
  assert.throws(() => gate.assert(before), /suspended|obsolete/);
  gate.resume();
  assert.equal(gate.accepts(before), false);
  assert.equal(gate.accepts(gate.epoch), true);
  const returned = gate.epoch;
  gate.suspend();
  gate.resume();
  assert.equal(gate.accepts(returned), false);
});
