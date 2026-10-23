/** Chromatic Flat UI colors; omit neutrals that can suggest inactive agents. */
const AGENT_PALETTE = [
  '#1abc9c', '#2ecc71', '#3498db', '#9b59b6',
  '#16a085', '#27ae60', '#2980b9', '#8e44ad',
  '#f1c40f', '#e67e22', '#e74c3c',
  '#f39c12', '#d35400', '#c0392b',
] as const;
/** Custom names get a varied, stable palette color; an explicit hex takes precedence. */
export function agentNameColor(name: string): string {
  const suffix = /-([0-9a-f]{6})$/.exec(name);
  if (suffix) return `#${suffix[1]}`;
  let hash = 2166136261;
  for (const char of name) hash = Math.imul(hash ^ char.charCodeAt(0), 16777619);
  return AGENT_PALETTE[(hash >>> 0) % AGENT_PALETTE.length]!;
}
