/** Admission and privileged dispatch for a message from an app surface. */
export interface AppMessageRouting<Event extends { data: unknown }> {
  accepts(event: Event): boolean;
  active(): boolean;
  /** Handle backend messages and return true when handled. */
  backend(message: Event["data"]): boolean;
}
