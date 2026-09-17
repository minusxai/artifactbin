/**
 * Free text → a safe identifier, used wherever a label becomes part of a path or
 * a filename: a run's rows file, a screenshot's name, an agent's workspace
 * directory. One implementation, because two drifting ones give the same run two
 * different names.
 */
export function slug(text: string, maxLength = Infinity): string {
  const s = text.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  return s.slice(0, maxLength);
}
