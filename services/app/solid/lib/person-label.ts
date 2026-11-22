/** Prefer the public name; older responses may supply only the person's public address. */
export function personLabel(person: { name?: string | null; username?: string | null } | null | undefined, fallback = 'Someone'): string {
  return person?.name?.trim() || (person?.username ? `@${person.username}` : fallback);
}
