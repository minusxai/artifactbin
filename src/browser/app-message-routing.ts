import type { AppMessageRouting } from "./app-message-routing-contracts.ts";

/** Invoke eligible handlers, then return whether ordinary UI dispatch may continue. */
export function admitAppMessage<Event extends { data: unknown }>(
  event: Event,
  routing: AppMessageRouting<Event>,
): boolean {
  if (!routing.accepts(event)) return false;
  if (!routing.active()) return false;
  return !routing.backend(event.data);
}
