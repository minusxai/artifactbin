/**
 * THE DOORS — every rate limit in the product, one vocabulary. A door is a name; every door has the same
 * four knobs (RATE_LIMITER__<DOOR>_{MAX,WINDOW,BURST,KEY}). The vocabulary lives here so the app and the
 * proxy share it without either importing the other; the limiter itself is in utils.
 */
export const DOORS = {
  GLOBAL: { max: 600, windowSeconds: 60, burst: 1, key: 'ip' },
  ANON_MINT: { max: 0, windowSeconds: 3600, burst: 5, key: 'ip' },
  START_LINK: { max: 0, windowSeconds: 3600, burst: 5, key: 'ip' },
  /** Per EMAIL ADDRESS (the actor id is the address): an office behind one NAT is many people. */
  LOGIN_SEND: { max: 5, windowSeconds: 3600, burst: 1, key: 'actor' },
  /** Per ip, generous: the guess cap per CODE is Better Auth's (5); this only bounds a flood. */
  LOGIN_VERIFY: { max: 60, windowSeconds: 900, burst: 1, key: 'ip' },
  PUBLISH: { max: 600, windowSeconds: 60, burst: 1, key: 'actor' },
  EDIT: { max: 600, windowSeconds: 60, burst: 1, key: 'actor' },
  MUTATE: { max: 60, windowSeconds: 60, burst: 1, key: 'ip' },
  QUERY: { max: 600, windowSeconds: 60, burst: 1, key: 'ip' },
  EXPORT: { max: 30, windowSeconds: 60, burst: 1, key: 'actor' },
  EVENTS_STREAMS: { max: 20, windowSeconds: 0, burst: 1, key: 'ip' },
  OAUTH_TOKEN: { max: 30, windowSeconds: 60, burst: 1, key: 'ip' },
} as const satisfies Record<string, DoorConfig>;

export type DoorName = keyof typeof DOORS;
export type DoorKey = 'ip' | 'actor' | 'ip+actor';

export interface DoorConfig {
  max: number;
  windowSeconds: number;
  burst: number;
  key: DoorKey;
}

export interface Identity {
  ip: string;
  actorId?: string | null;
  /** The caller proved a credential: BURST applies, on the same bucket. */
  holder?: boolean;
}

export interface Decision {
  allowed: boolean;
  /** Seconds until the next attempt could succeed (0 when allowed). */
  retryAfter: number;
  /** Which door decided — for the deny body. */
  door: DoorName;
}

export interface Lease extends Decision {
  release(): Promise<void>;
}

/** What a backend must do: count hits in a window (and record this one), and hold/release leases. */
export interface LimiterBackend {
  /** Record a hit unless doing so would exceed `max`; answer the count BEFORE this hit and the oldest hit's time. */
  hit(bucket: string, windowMs: number, max: number, now: number): Promise<{ count: number; oldest: number | null }>;
  acquire(bucket: string, max: number): Promise<boolean>;
  release(bucket: string): Promise<void>;
}


export interface Limiter {
  limit(door: DoorName, id: Identity, opts?: { now?: number }): Promise<Decision>;
  acquire(door: DoorName, id: Identity): Promise<Lease>;
  config(door: DoorName): DoorConfig;
}
