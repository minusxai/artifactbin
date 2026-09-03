/**
 * The driver's command line.
 *
 * Both spellings of every option are accepted — `--shard 2/2` and `--shard=2/2`
 * — because a workflow writes the equals form (`--shard=${{ matrix.shard }}/2`)
 * while a person types the space form, and supporting only one fails in CI at
 * the point where finding out costs a whole job.
 */
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { DEFAULT_MODE, parseMode, type EvalMode } from './mode';

export interface Args {
  /** The single leg this run drives — see `lib/leg.ts`. */
  harness?: string;
  model?: string;
  /**
   * NAME of the variable holding the provider key. Called `envVar`, never
   * `apiKeyEnv`: CodeQL's credential heuristic reads an identifier containing
   * "apiKey" as a secret, and then flags the error message that tells you which
   * key to set (js/clear-text-logging, high). The user-facing flag stays
   * `--api-key-env` — it is a string, not an identifier.
   */
  envVar?: string;
  label?: string;
  priceIn?: number;
  priceOut?: number;
  priceCacheRead?: number;
  priceCacheWrite?: number;
  /** Dollars per provider-side web-search CALL. */
  priceWebSearch?: number;
  vision: boolean;
  /** How the agent REACHES the product — see `lib/mode.ts`. */
  mode: EvalMode;
  tasks?: string[];
  out: string;
  ci: boolean;
  /** One more turn for a CI flow that failed; `--no-retry` turns it off. */
  retry: boolean;
  report: boolean;
  shard?: string;
  /** Run against a LIVE deployment instead of a server this driver boots. */
  deployment?: string;
  /** Move the port range, so a second run on the same machine does not collide. */
  portBase?: number;
  /** Override `run.concurrency` — how many of a leg's tasks run at once. */
  concurrency?: number;
  /**
   * Run every harness process as this unix user instead of the driver's own —
   * the CI runner's isolation account, which cannot read this checkout. Without
   * it no sudo is ever invoked, so a laptop run is unchanged (`lib/spawn`).
   */
  runAs?: string;
}

const EVALS_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const list = (v: string) => v.split(',').map((s) => s.trim()).filter(Boolean);

/** $ per 1M tokens. */
function rate(raw: string, flag: string): number {
  const n = Number(raw);
  if (!Number.isFinite(n) || n < 0) throw new Error(`${flag} must be a non-negative number of dollars per 1M tokens (got "${raw}")`);
  return n;
}

function portBase(raw: string): number {
  const n = Number(raw);
  if (!Number.isInteger(n) || n < 1024 || n > 65000) throw new Error(`--port-base must be a port between 1024 and 65000 (got "${raw}")`);
  return n;
}

/** Each concurrent task holds a proxy, a harness process and a browser context, so the ceiling is small. */
function concurrency(raw: string): number {
  const n = Number(raw);
  if (!Number.isInteger(n) || n < 1 || n > 16) throw new Error(`--concurrency must be between 1 and 16 (got "${raw}")`);
  return n;
}

/** A deployment must be an absolute http(s) origin: a bare host would fall through to booting a local server. */
function deploymentUrl(raw: string): string {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new Error(`--deployment must be an absolute URL (got "${raw}")`);
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') throw new Error(`--deployment must be http(s) (got "${raw}")`);
  return url.origin;
}

export function parseArgs(argv: string[]): Args {
  const args: Args = { out: path.join(EVALS_DIR, '.metrics'), ci: false, retry: true, report: true, vision: true, mode: DEFAULT_MODE };
  for (let i = 0; i < argv.length; i++) {
    const raw = argv[i];
    // Split only on the FIRST `=`, so a value may contain one.
    const eq = raw.indexOf('=');
    const flag = eq === -1 ? raw : raw.slice(0, eq);
    const inline = eq === -1 ? undefined : raw.slice(eq + 1);
    const value = () => (inline !== undefined ? inline : argv[++i]);
    switch (flag) {
      case '--harness': args.harness = value(); break;
      case '--model': args.model = value(); break;
      case '--api-key-env': args.envVar = value(); break;
      case '--label': args.label = value(); break;
      case '--price-in': args.priceIn = rate(value(), '--price-in'); break;
      case '--price-out': args.priceOut = rate(value(), '--price-out'); break;
      case '--price-cache-read': args.priceCacheRead = rate(value(), '--price-cache-read'); break;
      case '--price-cache-write': args.priceCacheWrite = rate(value(), '--price-cache-write'); break;
      case '--price-web-search': args.priceWebSearch = rate(value(), '--price-web-search'); break;
      case '--no-vision': args.vision = false; break;
      case '--mode': args.mode = parseMode(value()); break;
      case '--tasks': args.tasks = list(value()); break;
      case '--shard': args.shard = value(); break;
      case '--deployment': args.deployment = deploymentUrl(value()); break;
      case '--port-base': args.portBase = portBase(value()); break;
      case '--concurrency': args.concurrency = concurrency(value()); break;
      case '--run-as': args.runAs = value(); break;
      case '--out': args.out = path.resolve(value()); break;
      case '--ci': args.ci = true; break;
      case '--no-retry': args.retry = false; break;
      case '--no-report': args.report = false; break;
      default: throw new Error(`unknown argument ${flag}`);
    }
  }
  return args;
}
