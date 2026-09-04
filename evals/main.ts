/**
 * The eval driver.
 *
 *   npm run eval -- --harness <name> --model <id> --api-key-env <VAR> [--label L]
 *                   [--price-in N --price-out N] [--no-vision]
 *                   [--mode fetched_skill+api_action|fetched_skill+mcp_action|installed_skill+api_action|installed_skill+mcp_action]
 *                   [--tasks x,y] [--deployment https://…] [--out dir] [--no-report]
 *                   [--run-as user]   run the harness as another unix account (CI isolation)
 *   npm run eval -- --ci …          the CI task set, exit 1 on any failed flow. A failed
 *                                   flow gets ONE more turn and is NAMED when it passes
 *                                   there (lib/second-attempt); `--no-retry` turns that off.
 *
 * ONE leg per run, described entirely on the command line, writing ONE run
 * directory. Which agents exist and which to compare belongs to the caller —
 * `deploys/artifact-eval.yml` owns the roster; `eval:report` merges N of these
 * directories without knowing why there are N.
 *
 * Per RUN: either boot a product server from the prod build with a recording
 * reverse proxy in front, or point a recording MITM proxy at a live deployment.
 * Per TASK: mint a start document, hand the agent the brief plus the product's
 * own start line, run the harness CLI in a temp workspace outside this repo,
 * then score — the ledger (protocol), the served document (product truth),
 * Playwright (render guards + captures), `/export` (the product's own capture)
 * — into minusx-schema rows.
 */
import { fileURLToPath } from 'node:url';
import fs from 'node:fs';
import path from 'node:path';
import { chromium, type Browser } from 'playwright';
import { EvalConfigSchema, type EvalConfig, type Task } from './lib/contracts';
import { legFromArgs, type Leg } from './lib/leg';
import { discoverTasks, parseShard, selectTasks, shardTasks } from './lib/task-set';
import { checksToRecord, gatedChecks, verdictFor } from './lib/score/verdict';
import { buildPrompt, type Access } from './lib/tasks';
import { actionTransport, installsSkills, planTransport } from './lib/mode';
import { materializePlugin } from './lib/plugin-kit';
import { taskCost } from './lib/price';
import { BASELINE_FLOW, BASELINE_PROMPT, BASELINE_ROWS_ID, measureBaseline } from './lib/baseline';
import { ledgerMetrics, ledgerRows, parseLedger, scoredArtifactId, writtenArtifactIds } from './lib/ledger';
import { adapterFor } from './lib/harness';
import { runInvocation } from './lib/spawn';
import { countCheckoutReads } from './lib/local-reads';
import { RunRecorder } from './lib/rows';
import { devOutboxPath, serverDataDir, serverEnv, serverPorts, startServer } from './lib/server';
import { mapConcurrent } from './lib/pool';
import { exitWhenDone, settleWithin, TEARDOWN_MS } from './lib/shutdown';
import { DRIVER_HEADER, startProxy } from './lib/proxy';
import { mintStartDocument, mintStartDocumentAs } from './lib/retry';
import { acquireCredential, credentialSourceFor, deploymentLoginEmail, localLoginEmail, memoizeCredential, shareForScoring, writeArtifactbinEnv, type Credential } from './lib/credential';
import { agentProxyEnv, startMitmProxy } from './lib/mitm';
import { exportDocument, inspectDocument, screenshotDocument } from './lib/score/browser';
import { dataflowRows, productMetrics } from './lib/score/product';
import { prepareTask, runChecks, scorerFor } from './lib/score/kinds';
import { credentialEnv, readDotEnv } from './lib/env';
import { parseArgs } from './lib/args';
import { registerSecret, scrubRegistered } from './lib/secrets';
import { createWorkspace } from './lib/workspace';
import { collectRun, mergeRuns, renderSummaryMarkdown, writeReport } from './lib/report';
import { VIEWPORT_WIDTH_PX } from './lib/image-variants';

// The cwd contract (P3 §B.4) is enforced by evals/preload.cjs — BEFORE this
// module graph loads; a chdir here would run after the hoisted imports already read cwd.

const EVALS_DIR = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(EVALS_DIR, '..');


function loadJson<T>(file: string, parse: (v: unknown) => T): T {
  return parse(JSON.parse(fs.readFileSync(file, 'utf8')));
}



const log = (msg: string) => console.log(`[eval] ${msg}`);

/** Read the one-time token from the product's exact paste: a `token` task's driver needs it. */
function tokenFromPaste(startPrompt: string): string {
  const token = /using this token: (mx_[A-Za-z0-9_-]+)/.exec(startPrompt)?.[1];
  if (!token) throw new Error('start paste carries no token');
  return token;
}

/** Publish the document a task asks the agent to EDIT, as the agent's own token would have. */
async function seedDocument(base: string, id: string, token: string, markup: string): Promise<void> {
  const res = await fetch(`${base}/api/artifacts/${id}`, {
    method: 'PUT',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${token}`, [DRIVER_HEADER]: '1' },
    body: JSON.stringify({ markup }),
  });
  if (!res.ok) throw new Error(`seeding document ${id} → ${res.status} ${await res.text()}`);
}

/** A task's outcome for one leg. `null` = skipped: this harness cannot run it at all. */
import { runSecondAttempts, verdictLine, type MergedVerdicts, type Outcome } from './lib/second-attempt';

interface LegRun {
  /** Unix user the harness process runs as, when CI isolates it from this checkout (`lib/spawn`). */
  runAs?: string;
  /**
   * The leg's credential, acquired ONCE and memoized by the caller: every task and every second
   * attempt reuses the same login (`lib/credential`). Null for the copy-text treatment, whose token
   * the product hands to the agent itself. `origin` is the address the product TRUSTS when that is
   * not the one the driver dials — a booted server publishes the leg's proxy as its public base URL.
   */
  credentialFor: (base: string, origin?: string) => Promise<Credential | null>;
}

async function runLeg(leg: Leg, tasks: Task[], config: EvalConfig, outDir: string, browser: Browser, run: LegRun): Promise<Outcome[]> {
  const runAs = run.runAs;
  const apiKey = leg.apiKey;
  const ports = serverPorts(config.server.portBase, 0);
  const legDir = outDir;
  const startedAt = new Date().toISOString();
  // main() owns the run directory and empties it once, BEFORE the first attempt.
  // Emptying it here as well was invisible while a leg ran exactly once and
  // destructive the moment one did not: the second attempt wiped the first
  // attempt's kept artifacts AND every sibling task's rows, leaving a run
  // directory that described one task and a report that had lost the rest.
  fs.mkdirSync(legDir, { recursive: true });
  // Two ways to reach the product, and they need OPPOSITE proxies.
  //
  // A server this driver boots is happy to mint its links from whatever Host it is asked on, so a
  // reverse proxy can simply BE the base URL and see everything.
  //
  // A deployment is not: artifactbin.dev answers a foreign Host with a 307 to its login page, and
  // then mints links pointing at itself — so a reverse proxy would be walked straight past. There the
  // agent goes into a PROXIED ENVIRONMENT instead (`lib/mitm.ts`): it is handed the deployment's own
  // real link, and its traffic is intercepted by where it is told to send it rather than by what it
  // is told to ask for.
  //
  // The SERVER is per leg; the PROXY is per task. One ledger per task is what makes a leg's tasks
  // independent — attributing a shared ledger by wall clock was the only reason they ran one at a
  // time, and it silently mis-scored the moment two overlapped.
  let stopServer: (() => Promise<void>) | null = null;
  let productUrl: string;
  // The origin the product trusts for a WRITE — its public base URL, which for a booted server is the
  // leg's proxy rather than the server port the driver dials (measured: `403 INVALID_ORIGIN` otherwise).
  let productOrigin: string | undefined;
  if (config.deployment) {
    productUrl = config.deployment;
  } else {
    log(`${leg.label}: booting server :${ports.server}`);
    const serverEnvironment = serverEnv({ base: process.env, ports, dataDir: serverDataDir(legDir), extra: config.server.env });
    const server = await startServer({
      repoRoot: REPO_ROOT,
      env: serverEnvironment,
      logPath: path.join(legDir, 'server.log'),
    });
    stopServer = server.stop;
    productUrl = server.url;
    productOrigin = serverEnvironment.APP__PUBLIC_BASE_URL;
  }

  // WHO the agent will be. One login per leg, against the product's own address rather than a task's
  // proxy: the driver's setup traffic has no business in a task's ledger, and the token has to outlive
  // every proxy the leg opens. `paste` acquires nothing — see lib/credential.
  const credential = await run.credentialFor(productUrl, productOrigin);
  if (credential) {
    registerSecret(credential.token);
    log(`${leg.label}: publishing as ${credential.email ?? 'the eval account'} (${credential.owner})`);
  }

  /** This task's own proxy and its own ledger. Ports are ephemeral, so any number may be live at once. */
  async function startTaskProxy(taskId: string): Promise<{ agentBase: string; agentEnv: Record<string, string>; ledgerPath: string; stop: () => Promise<void> }> {
    const ledgerPath = path.join(legDir, 'runs', taskId, 'ledger.jsonl');
    fs.mkdirSync(path.dirname(ledgerPath), { recursive: true });
    if (config.deployment) {
      const mitm = await startMitmProxy({
        port: 0,
        host: new URL(config.deployment).hostname,
        ledgerPath,
        // One CA per leg: `createCa` reuses an existing one, so every task's proxy is trusted by the
        // same bundle and the openssl work happens once.
        caDir: path.join(legDir, 'ca'),
      });
      log(`${leg.label}/${taskId}: proxying ${config.deployment} through :${mitm.port}`);
      // The agent is given the DEPLOYMENT's own address; its traffic is caught by where it SENDS.
      return { agentBase: config.deployment, agentEnv: agentProxyEnv(mitm.url, mitm.ca), ledgerPath, stop: mitm.stop };
    }
    const proxy = await startProxy({ port: 0, target: productUrl, ledgerPath });
    log(`${leg.label}/${taskId}: proxy :${proxy.port}`);
    // The agent is given the PROXY's address; the server mints its links from it.
    return { agentBase: proxy.url, agentEnv: {}, ledgerPath, stop: proxy.stop };
  }

  // What this column costs BEFORE it does anything: one turn, one word, no product. It opens the
  // report because a per-task total hides it, which is how a matrix once read an 18,454-token-per-turn
  // harness flag as "the plugin is 3.4× more expensive". Reported, never subtracted (lib/baseline.ts).
  try {
    const baseDir = path.join(legDir, 'baseline');
    const basePlugin = installsSkills(leg.mode.run)
      ? materializePlugin(path.join(baseDir, 'plugin'), config.deployment ?? productUrl, actionTransport(leg.mode.run) === 'api' ? 'curl' : 'mcp')
      : undefined;
    const baseline = await measureBaseline({
      leg, adapter: adapterFor(leg.harness), apiKey, dir: baseDir, plugin: basePlugin, timeoutMs: config.run.timeoutMs, runAs,
    });
    const brec = new RunRecorder(legDir, { label: leg.label, target: productUrl, harness: leg.harness, model: leg.model, startedAt, mode: leg.mode.run }, BASELINE_ROWS_ID);
    brec.flow(BASELINE_FLOW, `${BASELINE_PROMPT} — the harness's fixed context, paid again on EVERY turn of every task below.`, { graded: false });
    brec.record(BASELINE_FLOW, 'tokens_in', baseline.tokensIn);
    brec.record(BASELINE_FLOW, 'tokens_out', baseline.tokensOut);
    brec.record(BASELINE_FLOW, 'cost_usd', baseline.costUsd);
    brec.record(BASELINE_FLOW, 'turns', baseline.turns);
    brec.finalize(true);
    log(`${leg.label}: baseline ${baseline.tokensIn ?? '?'} tokens_in per turn`);
  } catch (err) {
    // A leg whose probe fails still runs its tasks — the baseline is information, not a gate.
    log(`${leg.label}: baseline probe failed (${err instanceof Error ? err.message : String(err)})`);
  }

  try {
    return await mapConcurrent(tasks, config.run.concurrency, async (task) => {
      const t = await startTaskProxy(task.id);
      try {
        return await runTask({ leg, task, config, apiKey, legDir, ledgerPath: t.ledgerPath, productUrl, agentBase: t.agentBase, agentEnv: t.agentEnv, browser, startedAt, credential, ...(runAs ? { runAs } : {}) });
      } catch (err) {
        // A task's own failure is ITS failure. Letting it reject would take down the server its
        // siblings are still running against — and their agent time is already paid for. `false`
        // rather than `null`, because null means "deliberately not run" (a harness with no MCP
        // client) and would drop a crashed task out of the count instead of failing it.
        log(`${leg.label}/${task.id}: FAILED — ${scrubRegistered(String(err))}`);
        return false;
      } finally {
        await t.stop();
      }
    });
  } finally {
    if (stopServer) await stopServer();
  }
}



interface TaskRun {
  leg: Leg; task: Task; config: EvalConfig; apiKey: string; legDir: string; ledgerPath: string; browser: Browser;
  /** Where the DRIVER talks to the product, and where a document's public URL is rooted. */
  productUrl: string;
  /** The base the AGENT is given — the reverse proxy locally, the deployment itself behind a MITM. */
  agentBase: string;
  /** Extra environment that puts the harness behind the MITM proxy. Empty for a local run. */
  agentEnv: Record<string, string>;
  /** When the LEG started (ISO) — one value for every task, so the report can be named by it. */
  startedAt: string;
  /** Unix user the harness process runs as, when CI isolates it from this checkout (`lib/spawn`). */
  runAs?: string;
  /** The account this leg publishes as, or null when the product's own paste hands the token over. */
  credential: Credential | null;
}

async function runTask(r: TaskRun): Promise<Outcome> {
  const { leg, task, config } = r;
  const adapter = adapterFor(leg.harness);
  // The mode is authoritative. A harness that cannot provide its action transport
  // runs the nearest treatment and the report names the substitution.
  const transport = planTransport(leg.harness, actionTransport(leg.mode.run));
  if (transport.substitutedWhy) log(`${leg.label}/${task.id}: ${transport.substitutedWhy}`);

  const rec = new RunRecorder(r.legDir, { label: leg.label, target: r.productUrl, harness: leg.harness, model: leg.model, startedAt: r.startedAt, mode: leg.mode.run, ...(leg.mode.substitutedWhy ? { modeSubstitutedWhy: leg.mode.substitutedWhy } : {}) }, task.id);
  rec.flow(task.id, task.brief);
  // The RECORD of the run stays in the repo; the agent's workspace does not (see `lib/workspace.ts`).
  const runDir = path.join(r.legDir, 'runs', task.id);
  fs.mkdirSync(runDir, { recursive: true });
  const { root: wsRoot, cwd, homeDir } = createWorkspace(leg.label, task.id);
  fs.writeFileSync(path.join(runDir, 'workspace.txt'), wsRoot);
  for (const [rel, contents] of Object.entries(task.files ?? {})) {
    const abs = path.join(cwd, rel);
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, contents);
  }

  // The start document is minted THROUGH the proxy: the product builds the document URL in the paste from the request's
  // origin, so this is what puts the proxy's address in the agent's hands. The driver's own call lands in
  // the ledger before `from` and is sliced out of the run window.
  // Retried, because this call is the DRIVER's and the agent's turn is not: three tasks of one
  // production leg died here on `POST /api/start → 502`, all inside 200 ms, when three proxies
  // opened at once against a deployment mid-roll. Nothing was learned and the column had three
  // holes. Only transient statuses retry — a 4xx is an answer (lib/retry.ts).
  // A leg with an ACCOUNT credential does not spend `/api/start`: that mints an anonymous token, and its
  // document would belong to somebody other than the token the agent was given. The driver creates the
  // start document itself, as that account, `unlisted` so every anonymous product-truth read below is
  // unchanged (measured — lib/retry.mintStartDocumentAs).
  const start = r.credential
    ? await mintStartDocumentAs(r.agentBase, DRIVER_HEADER, r.credential.token)
    : await mintStartDocument(r.agentBase, DRIVER_HEADER);
  // The paste must name the base the agent will be given, or the agent's traffic misses the ledger.
  if (!r.credential && !start.prompt.includes(r.agentBase)) throw new Error(`start paste is not on ${r.agentBase}`);

  // A `token` task needs the driver to hold the credential (to seed a document, or to write an MCP config),
  // so the driver reads it from the paste; a `start-link` task passes that paste on untouched.
  //
  // Only fetched_skill+api_action can pass the product paste through untouched. Installed
  // skills must exist before the turn, while MCP needs the token in the harness
  // connection; both therefore use the driver's token handoff.
  const installed = installsSkills(leg.mode.run);
  let access: Access = { kind: 'start-link', startPrompt: start.prompt };
  let mcp: { name: string; url: string; token: string } | undefined;
  // ONE place the driver's own credential is decided, and one place it is spent. It used to be
  // decided twice — an account credential in one branch, the paste token in the other — and every
  // setup step had to be written into both or work on only some legs.
  const driverToken = r.credential
    ? r.credential.token
    : task.handoff === 'token' || installed || transport.run === 'mcp'
      ? tokenFromPaste(start.prompt)
      : null;
  if (driverToken) {
    if (task.seed) await seedDocument(r.agentBase, start.id, driverToken, task.seed);
    access = { kind: 'token', base: r.agentBase, token: driverToken, id: start.id };
    if (transport.run === 'mcp') {
      // The token rides the harness's MCP configuration, as it does for a person who connected the server.
      mcp = { name: 'artifactbin', url: `${r.agentBase}/mcp`, token: driverToken };
    } else if (installed && r.credential) {
      // …and for API actions it rides the skill's own connection file in the agent's HOME, which is why
      // the prompt can stop naming it. An MCP leg never gets this file: a second, curl-shaped way in
      // would measure something other than the MCP treatment. Only ever written for an ACCOUNT
      // credential, which is the one an installed mode is given (`credentialSourceFor`).
      writeArtifactbinEnv(homeDir, r.agentBase, driverToken);
    }
  }
  // The skills are built for the base THIS TASK will be reached on: each task has its own
  // recording proxy on its own port, and a skill naming another one sends the traffic past
  // this task's ledger. `lib/plugin-package` is the same generator that ships the public
  // marketplace, so the installed vocabulary is the served vocabulary by construction.
  // The action axis selects the API/curl or MCP/tool compilation independently.
  const plugin = installsSkills(leg.mode.run)
    ? materializePlugin(path.join(runDir, 'plugin'), r.agentBase, transport.run === 'api' ? 'curl' : 'mcp')
    : undefined;
  // WHAT THIS KIND OF TASK NEEDS, and then the baseline — in that order, which is `prepareTask`'s
  // whole job (`lib/score/kinds`). A `comment` task's setup posts a comment, and the anchor stamp is
  // a REAL edit that bumps the version and rewrites the markup, so a baseline read before it would
  // make `published` true for a document the agent never touched.
  //
  // The start document as served BEFORE the agent ran is what `published` compares against, because
  // the start document is not blank — it serves "Untitled / Waiting for your agent…", so "has
  // content" cannot tell a written document from an untouched one.
  const scorer = scorerFor(task.kind);
  const driverHeaders = { [DRIVER_HEADER]: '1' };
  const prepared = await prepareTask(
    scorer,
    { task, base: r.agentBase, id: start.id, token: driverToken, driverHeaders, log: (m) => log(`${leg.label}/${task.id}: ${m}`) },
    async () => {
      const res = await fetch(`${r.productUrl}/a/${start.id}/raw?chrome=0`);
      return { status: res.status, html: res.ok ? await res.text() : '' };
    },
  );
  if (!prepared.ok) {
    // The DRIVER failed, not the agent — and the driver's calls carry `DRIVER_HEADER`, so the ledger
    // cannot see this at all. Without a check of its own it would show as a bare FAIL with no failing
    // check name and an empty `first_error`, which reads as "the agent did nothing". No turn is spent.
    log(`${leg.label}/${task.id}: SETUP FAILED at ${prepared.step} — ${prepared.error}`);
    rec.record(task.id, 'setup_ok', false, 'pass');
    rec.record(task.id, 'first_error', `setup/${prepared.step}: ${prepared.error}`, 'text');
    rec.finalize(false);
    return false;
  }
  const baseline = prepared.baseline;

  const prompt = buildPrompt(task, access, { vision: leg.vision, mode: leg.mode.run });
  fs.writeFileSync(path.join(runDir, 'prompt.txt'), prompt);

  const ctx = { leg, prompt, cwd, homeDir, apiKey: r.apiKey, maxTurns: config.run.maxTurns, maxBudgetUsd: config.run.maxBudgetUsd, mcp, plugin };
  log(`${leg.label}/${task.id}: doc ${start.id} — running ${leg.harness} (${leg.model})`);
  await adapter.prepare(ctx);
  const spawned = await runInvocation({ ...adapter.invocation(ctx), redact: [r.apiKey] }, {
    cwd,
    baseEnv: { ...process.env, ...r.agentEnv },
    timeoutMs: config.run.timeoutMs,
    stdoutPath: path.join(runDir, 'transcript.jsonl'),
    stderrPath: path.join(runDir, 'stderr.log'),
    // The harness's HOME is this run's home in every case — `~/.artifactbin.env` resolves there, and
    // nothing the CLI writes under $HOME lands in the runner's own. Under `--run-as` the workspace ROOT
    // goes with it: it is a 0700 mkdtemp directory the other user could not otherwise traverse.
    homeDir,
    workspaceRoot: wsRoot,
    ...(r.runAs ? { runAs: r.runAs } : {}),
  });
  const result = adapter.reduce(spawned.stdout);
  if (spawned.timedOut) { result.ok = false; result.error = `timed out after ${config.run.timeoutMs} ms`; }
  fs.writeFileSync(path.join(runDir, 'result.json'), JSON.stringify({ ...result, exitCode: spawned.exitCode, timedOut: spawned.timedOut, truncated: spawned.truncated }, null, 2));
  log(`${leg.label}/${task.id}: ${result.ok ? 'harness ok' : `harness error: ${result.error}`} in ${Math.round(spawned.durationMs / 1000)}s, ${result.turns ?? '?'} turns`);

  // --- score: ledger
  // The file holds exactly this task's agent traffic: its own proxy, and the driver's own setup
  // calls marked and skipped (`DRIVER_HEADER`). No window, so nothing depends on when it ran.
  const ledger = parseLedger(fs.readFileSync(r.ledgerPath, 'utf8'));
  const lm = ledgerMetrics(ledger);

  // --- score: product. The agent need not have used the document the start link named — Claude Opus 5
  // created its own, twice — so `scoredArtifactId` decides which artifact to score (its answer, then the
  // ledger, then the start document) and `used_start_document` records whether it was the one it was given.
  const targetId = scoredArtifactId({ finalMessage: result.finalMessage, ledger, startId: start.id });

  // AND THEN THE PERSON SHARES IT. Under an account credential every document the agent made is born
  // PRIVATE, while every read below is anonymous — the reader's view is the whole point of the score —
  // so a flawless run read as `published: false` (PR #16 CI, the `data` task). Before the first of those
  // reads the driver does what the person behind the agent does next: makes the run's artifacts unlisted
  // through the owner's own sharing door. The start document is already unlisted and datasets and images
  // are born unlisted, so this only ever moves the ones the agent created for itself. A pre-provisioned
  // `EVAL_ACCOUNT_TOKEN` names no session, so there is no door to knock on and the run is left alone.
  if (r.credential?.owner === 'account' && r.credential.cookie) {
    const shared = await shareForScoring({
      base: r.agentBase,
      cookie: r.credential.cookie,
      ids: [...writtenArtifactIds(ledger), targetId],
      headers: { [DRIVER_HEADER]: '1' },
    });
    log(`${leg.label}/${task.id}: shared ${shared.length} artifact(s) for scoring`);
  }

  const docUrl = `${r.productUrl}/a/${targetId}`;
  const servedRes = await fetch(`${docUrl}/raw?chrome=0`);
  const served = { status: servedRes.status, html: servedRes.ok ? await servedRes.text() : '' };
  const pm = productMetrics({ served, baseline });

  // --- score: browser (only when there is a document to look at)
  // The browser loads through the PROXY, so the document's own data transport lands in the ledger and
  // `query_ran` can be read from it. Those entries fall after `to`, outside the agent's slice.
  let inspection: Awaited<ReturnType<typeof inspectDocument>> | null = null;
  if (pm.published) {
    inspection = await inspectDocument(r.browser, `${docUrl}/raw?chrome=0`, VIEWPORT_WIDTH_PX.mobile);
  }
  // The dataflow runs on the SERVER and rides the island, so the rows it produced are the evidence a
  // `<Query>` ran — not a `/query` request, which a static document never makes.
  const queryRows = dataflowRows(served.html);

  // What THIS KIND asks of the product, computed by the kind itself. `record` is how a kind reports
  // evidence that is not a verdict (`answered_by`, `split_verbatim`): a check name the task does not
  // gate is dropped from the report entirely (`checksToRecord`), so a row is the only way to say
  // something the reader should see either way. A failure INSIDE the checks is the DRIVER's — the
  // reads are ours — so it answers `checks_ok: false`, leaves the kind's checks unanswered and stops
  // them gating, rather than reporting an agent that ignored the comment.
  const checked = await runChecks(scorer, {
    task,
    productUrl: r.productUrl,
    startId: start.id,
    token: driverToken,
    driverHeaders,
    served,
    record: (metric, value, kind) => rec.record(task.id, metric, value, kind),
  });
  if (!checked.ok) log(`${leg.label}/${task.id}: CHECKS FAILED at ${checked.step} — ${checked.error}`);

  // --- rows: numbers
  rec.record(task.id, 'turns', result.turns);
  rec.record(task.id, 'tool_calls', result.toolCalls);
  // Turns spent READING docs — fetches plus every later page through a saved copy (`lib/docs-reads`).
  rec.record(task.id, 'docs_read_calls', result.docsReadCalls);
  // Turns spent reading THIS CHECKOUT — the skills a fetched_skill run is meant to discover over the
  // wire, and the task's own grading rubric. Anything above zero invalidates the column (`lib/local-reads`).
  // Null, like `docsReadCalls`, when the harness emitted no tool telemetry: nothing was observed either way.
  const checkoutReads = result.docsReadCalls === null ? null : countCheckoutReads(result.invocations, [REPO_ROOT]);
  rec.record(task.id, 'checkout_reads', checkoutReads);
  rec.record(task.id, 'tokens_in', result.tokens ? result.tokens.input + result.tokens.cacheRead + result.tokens.cacheWrite : null);
  rec.record(task.id, 'tokens_out', result.tokens ? result.tokens.output : null);
  const cost = taskCost(result, leg.price);
  rec.record(task.id, 'cost_usd', cost.usd);
  rec.record(task.id, 'duration_s', Math.round(spawned.durationMs / 100) / 10);
  // Every number the ledger answers, `versions` included, built in ONE pure place (`ledgerRows`) so
  // the count and its caller are one thing to break.
  for (const row of ledgerRows(ledger)) rec.record(task.id, row.metric, row.value);
  rec.record(task.id, 'query_rows', queryRows);
  // --- rows: text
  rec.record(task.id, 'first_error', checked.ok ? (lm.firstError ?? '') : `checks/${checked.step}: ${checked.error}`, 'text');
  rec.record(task.id, 'harness_error', result.error ?? '', 'text');
  // Where the cost came from: the harness's own figure, or our tokens × rates (a Codex run, which reports none).
  rec.record(task.id, 'cost_source', cost.source ?? '', 'text');
  rec.record(task.id, 'web_search_calls', result.webSearchCalls);
  // The mode rides in the ROWS as well as the meta: a substituted cell showing skill numbers
  // under an "mcp" heading would be a wrong comparison rather than a missing one.
  rec.record(task.id, 'how', [
    leg.mode.substitutedWhy ? `${leg.mode.run} (asked ${leg.mode.asked}: ${leg.mode.substitutedWhy})` : leg.mode.run,
    transport.substitutedWhy ? `${transport.run} (asked ${transport.asked}: ${transport.substitutedWhy})` : transport.run,
  ].join(' · '), 'text');
  rec.record(task.id, 'title', pm.title ?? '', 'text');
  rec.record(task.id, 'url', pm.published ? docUrl : '', 'text');
  rec.record(task.id, 'final_message', (result.finalMessage ?? '').slice(0, 300), 'text');

  // --- rows: checks
  const checks: Record<string, boolean | null> = {
    setup_ok: true,
    checks_ok: checked.ok,
    published: pm.published,
    published_first_try: pm.published && lm.publishedFirstTry,
    // Nothing to observe when the protocol arrived installed — null, never false (the
    // same rule the unobserved-ledger case follows).
    read_docs_before_write: installed ? null : lm.readDocsBeforeWrite,
    no_unknown_endpoints: lm.inventedEndpoints === 0,
    canonical_stable: lm.canonicalStable,
    has_title: pm.hasTitle,
    used_start_document: targetId === start.id,
    harness_ok: result.ok,
    no_console_errors: inspection ? inspection.consoleErrors.length === 0 : null,
    no_failed_responses: inspection ? inspection.failedResponses.length === 0 : null,
    fits_390px: inspection ? inspection.fits : null,
    chart_marks_drawn: inspection ? inspection.marks > 0 : null,
    dataset_created: lm.datasetCreated,
    query_ran: queryRows > 0,
    used_edits_endpoint: lm.usedEditsEndpoint,
    // Null, not false, when this harness has no MCP client and ran the task over REST.
    used_mcp: transport.substitutedWhy || leg.mode.substitutedWhy ? null : lm.usedMcp,
    no_local_checkout_reads: checkoutReads === null ? null : checkoutReads === 0,
    ...checked.checks,
  };
  // `checksToRecord` decides which checks become rows (task-specific ones only where the task grades them,
  // so an inapplicable check reads as "—" rather than a red FAIL); only the checks the TASK lists decide the
  // verdict (`verdictFor`). `canonical_stable`, for instance, is information about how the product
  // canonicalized the agent's markup, not a failure of the flow.
  const gated = gatedChecks(checked.ok ? [...task.checks] : task.checks.filter((c) => !checked.ungated.includes(c)), {
    trafficObserved: lm.observed,
    vocabularyInstalled: installed,
    transportSubstituted: transport.substitutedWhy !== null || leg.mode.substitutedWhy !== null,
    // The same signal `checkoutReads` was computed from: a harness that emitted no tool calls
    // cannot be asked what it read, so `no_local_checkout_reads` stops gating (verdict.ts).
    toolTelemetryObserved: result.docsReadCalls !== null,
  });
  for (const [c, v] of Object.entries(checksToRecord(checks, gated))) {
    rec.record(task.id, c, v, 'pass');
  }
  const { passed, failed } = verdictFor(checks, gated);
  if (inspection) {
    rec.record(task.id, 'console_errors', inspection.consoleErrors.join(' | ').slice(0, 300), 'text');
    rec.record(task.id, 'failed_responses', inspection.failedResponses.join(' | ').slice(0, 300), 'text');
  }

  // --- rows: images (every variant the config asks for and the product can produce)
  if (pm.published) {
    for (const size of config.capture.sizes) {
      for (const renderer of config.capture.renderers) {
        const variant = { size, renderer };
        const rel = rec.screenshotPath(task.id, 'document', variant);
        const abs = path.join(r.legDir, rel);
        try {
          if (renderer === 'playwright') {
            await screenshotDocument(r.browser, `${docUrl}/raw?chrome=0`, VIEWPORT_WIDTH_PX[size], abs);
          } else if (size === 'laptop') {
            // The product's export renders at its own fixed width; there is no phone-width export.
            const png = await exportDocument(r.productUrl, targetId);
            if (!png) continue;
            fs.writeFileSync(abs, png);
          } else {
            continue;
          }
          rec.image(task.id, 'document', rel, variant);
        } catch (e) {
          log(`${leg.label}/${task.id}: capture ${size}/${renderer} failed: ${(e as Error).message}`);
        }
      }
    }
  }

  rec.finalize(passed);
  log(`${leg.label}/${task.id}: ${passed ? 'PASS' : `FAIL (${failed.join(', ')})`} — doc ${targetId}${targetId === start.id ? '' : ' (NOT the start document)'}`);
  return passed;
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const parsed = loadJson(path.join(EVALS_DIR, 'config.json'), (v) => EvalConfigSchema.parse(v));
  const config: EvalConfig = {
    ...parsed,
    ...(args.deployment ? { deployment: args.deployment } : {}),
    ...(args.portBase ? { server: { ...parsed.server, portBase: args.portBase } } : {}),
    ...(args.concurrency ? { run: { ...parsed.run, concurrency: args.concurrency } } : {}),
  };

  // The filename decides the set: `<id>.eval.json` is a report column, a plain `<id>.json` is CI-only.
  const discovered = discoverTasks(path.join(EVALS_DIR, 'tasks'));
  const selected = selectTasks(discovered, { set: args.ci ? 'ci' : 'eval', ids: args.tasks });
  // `--shard i/n` splits the tasks across parallel CI jobs: a task is one agent run and cannot be shortened.
  const tasks = (args.shard ? shardTasks(selected, parseShard(args.shard)) : selected).map((t) => t.task);
  if (tasks.length === 0) {
    log(`shard ${args.shard} has no tasks — nothing to do`);
    return;
  }

  // ONE leg, described entirely on the command line. Which legs exist, and which to compare, is the
  // caller's business — this repo runs the one it is given and writes a single run directory.
  const keys = { ...readDotEnv(path.join(REPO_ROOT, '.env')), ...process.env } as Record<string, string>;
  const leg = legFromArgs(args, keys);
  registerSecret(leg.apiKey);

  // WHERE this leg's token comes from — the mode decides, `--credential` overrides, and a mode that
  // needs an account with no way to get one fails HERE, before an agent minute is spent. Acquired
  // lazily, and once per SERVER: the second attempt reuses a deployment's login but logs in again on a
  // server it booted, which is a new server with a new database (`memoizeCredential`).
  const credentials = credentialEnv(keys);
  // A server this driver BOOTS mails its login codes to a file rather than sending them (`lib/server
  // devOutboxPath`), so the run has an account of its own with no inbox configured anywhere — which is
  // what CI's `agent smoke` has. A deployment has no such file: there the inbox or a token is the way in.
  const localOutbox = config.deployment ? null : devOutboxPath(serverDataDir(args.out));
  // WHO this leg signs in as: a throwaway named after the leg on a server the driver booted; on a
  // DEPLOYMENT the configured inbox address SUB-ADDRESSED per harness, so each harness has its own
  // five-an-hour login door and its own account in the one shared catch-all mailbox (`deploymentLoginEmail`).
  const loginAs: { localOutbox?: string; email?: string } = localOutbox
    ? { localOutbox, email: localLoginEmail(leg.label, credentials) }
    : credentials.EVAL_LOGIN_EMAIL
      ? { email: deploymentLoginEmail(credentials.EVAL_LOGIN_EMAIL, leg.harness) }
      : {};
  const source = args.credential ?? credentialSourceFor(leg.mode.run, credentials, loginAs);
  const credentialFor = memoizeCredential(
    (base: string, origin?: string) => acquireCredential(source, { base, env: credentials, ...loginAs, ...(origin ? { origin } : {}) }),
    // A booted server does not survive the second attempt, and neither does the account on it.
    { reusable: !localOutbox },
  );
  log(`${leg.label}: credential source ${source}${loginAs.email ? ` as ${loginAs.email}` : ''}`);

  log(`${leg.label}: ${leg.harness} × ${leg.model} · tasks: ${tasks.map((t) => t.id).join(', ')} · out: ${args.out}`);
  fs.rmSync(args.out, { recursive: true, force: true });
  fs.mkdirSync(args.out, { recursive: true });

  const browser = await chromium.launch();
  let merged: MergedVerdicts = { verdicts: [], recovered: [], failed: [] };
  try {
    const first = await runLeg(leg, tasks, config, args.out, browser, { credentialFor, ...(args.runAs ? { runAs: args.runAs } : {}) });
    // A CI flow that failed gets ONE more turn, alone, and is named for it
    // (lib/second-attempt). The first attempt's artifacts are kept beside the
    // retry's rather than overwritten, so the flake can still be read.
    merged = await runSecondAttempts(tasks, first, {
      ci: args.ci,
      enabled: args.retry,
      outDir: args.out,
      announce: (task) => log(`${leg.label}/${task.id}: failed — one more turn, alone`),
      rerun: async (task) => (await runLeg(leg, [task], config, args.out, browser, { credentialFor, ...(args.runAs ? { runAs: args.runAs } : {}) }))[0],
    });
  } finally {
    await settleWithin(browser.close(), TEARDOWN_MS);
  }
  const verdicts = merged.verdicts;

  if (args.report) {
    const html = writeReport([{ dir: args.out }], path.join(args.out, 'report'));
    log(`report: ${html}`);
  }

  // What it cost, in the log and in the CI job summary — so the number does not live only inside an artifact.
  const summaryMd = renderSummaryMarkdown(mergeRuns([collectRun(args.out)]));
  console.log(`\n${summaryMd}\n`);
  if (process.env.GITHUB_STEP_SUMMARY) {
    fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, `## Agent eval — ${leg.label}\n\n${summaryMd}\n`);
  }

  log(verdictLine(merged));
  if (merged.recovered.length && process.env.GITHUB_STEP_SUMMARY) {
    fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, `\n> **Flaky**: ${merged.recovered.join(', ')} failed once and passed on a second attempt.\n`);
  }
  // The work and the scores are on disk by here. Anything still holding the event loop open is a
  // socket we no longer need, and waiting on it is how a finished leg becomes a CANCELLED job with
  // nothing uploaded — which is exactly what a 60-minute ceiling did to a run that had passed 3 of 4.
  exitWhenDone(args.ci && merged.failed.length ? 1 : 0);
}

main().catch((e) => {
  console.error(scrubRegistered(`[eval] ${e instanceof Error ? e.stack ?? e.message : String(e)}`));
  process.exit(2);
});
