import type { CheckCharge } from '@artifactbin/contracts';

/**
 * WHO MAY HOLD THE CHECK BROWSER, decided here, in the one browser service every app process shares, so the count is
 * right however many app processes ask. A check names what it is charged to (contracts `CheckCharge`: a person, their
 * group, their share of the group): each key may have ONE check in the lane at a time, and spends from its own hourly
 * count and hourly browser time; the lane holds `CHECK_LANE.running` drawing and `CHECK_LANE.waiting` waiting, past
 * which a check is `busy` at once. A refusal spends nothing; time is charged when the check ends, as it ran.
 */
export const CHECK_LANE = { running: 1, waiting: 2 } as const;
const HOUR_MS = 60 * 60 * 1000;

type Spent = { at: number; ms: number };

export function createCheckAdmission(clock: () => number = Date.now) {
  const holding = new Set<string>();
  const spent = new Map<string, Spent[]>();
  let inLane = 0;
  const recent = (key: string, now: number) => {
    const kept = (spent.get(key) ?? []).filter((entry) => now - entry.at < HOUR_MS);
    if (kept.length) spent.set(key, kept); else spent.delete(key);
    return kept;
  };
  return {
    /** A place in the lane for `charges` (an uncharged check takes only lane capacity), or why not. */
    admit(charges: readonly CheckCharge[]): { release(): void } | 'busy' | 'rate_limited' {
      const now = clock();
      const keys = [...new Set(charges.map((charge) => charge.key))];
      if (inLane >= CHECK_LANE.running + CHECK_LANE.waiting || keys.some((key) => holding.has(key))) return 'busy';
      for (const charge of charges) {
        const used = recent(charge.key, now);
        if (used.length >= charge.perHour || used.reduce((sum, entry) => sum + entry.ms, 0) >= charge.msPerHour) return 'rate_limited';
      }
      inLane++;
      for (const key of keys) holding.add(key);
      const entries = keys.map((key) => { const entry = { at: now, ms: 0 }; spent.set(key, [...(spent.get(key) ?? []), entry]); return entry; });
      let released = false;
      return {
        release() {
          if (released) return;
          released = true; inLane--;
          const ms = Math.max(0, clock() - now);
          for (const entry of entries) entry.ms = ms;
          for (const key of keys) holding.delete(key);
        },
      };
    },
  };
}
