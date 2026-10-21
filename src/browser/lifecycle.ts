import type { PublicationGate } from "./lifecycle-contracts.ts";
/** Every asynchronous publication carries the generation in which it started. */
export function publicationGate(): PublicationGate {
  let epoch = 0,
    active = true;
  return {
    get epoch() {
      return epoch;
    },
    get active() {
      return active;
    },
    suspend() {
      active = false;
      epoch++;
    },
    resume() {
      active = true;
      epoch++;
    },
    accepts(candidate) {
      return active && candidate === epoch;
    },
    assert(candidate) {
      if (!active || candidate !== epoch)
        throw Error("Publication suspended or obsolete");
    },
  };
}
