import { test } from "node:test";
import assert from "node:assert/strict";
import { admitAppMessage } from "../src/browser/app-message-routing.ts";
import type { AppMessageRouting } from "../src/browser/app-message-routing-contracts.ts";

for (const scenario of [
  {
    name: "unrecognized surface",
    accepted: false,
    active: true,
    backend: false,
    calls: ["accepts"],
    admitted: false,
  },
  {
    name: "inactive message cannot reach backend or dispatch",
    accepted: true,
    active: false,
    backend: false,
    calls: ["accepts", "active"],
    admitted: false,
  },
  {
    name: "active backend request is handled once",
    accepted: true,
    active: true,
    backend: true,
    calls: ["accepts", "active", "backend"],
    admitted: false,
  },
  {
    name: "active unhandled message reaches remaining dispatch",
    accepted: true,
    active: true,
    backend: false,
    calls: ["accepts", "active", "backend", "dispatch"],
    admitted: true,
  },
]) {
  test(scenario.name, () => {
    const calls: string[] = [];
    const event = { data: { kind: "request" } };
    const routing: AppMessageRouting<typeof event> = {
      accepts(received) {
        assert.equal(received, event);
        calls.push("accepts");
        return scenario.accepted;
      },
      active() {
        calls.push("active");
        return scenario.active;
      },
      backend(message) {
        assert.equal(message, event.data);
        calls.push("backend");
        return scenario.backend;
      },
    };
    const admitted = admitAppMessage(event, routing);
    if (admitted) calls.push("dispatch");
    assert.equal(admitted, scenario.admitted);
    assert.deepEqual(calls, scenario.calls);
  });
}
