/**
 * The `comment` kind: a human left a comment on the document, and the agent has
 * to answer it — make the change, reply on the thread, resolve it.
 *
 * SETUP posts that comment before the agent runs; CHECKS reads what came back.
 * Two sources, because one `GET` cannot answer all three: the THREAD comes from
 * `GET /api/artifacts/<id>/annotations?status=all` — the artifact GET inlines
 * only the OPEN set, so a resolved thread has left it and a PERFECT run would
 * score `responded:false, resolved:false` — and the DOCUMENT comes from
 * `/a/<id>/raw?chrome=0`, the same served truth every other product check reads.
 *
 * The predicates below are pure and transport-free — the setup and the checks
 * are the only things here that touch the wire.
 */
import { SetupFailure, type TaskScorer } from './contract';

/** Declared apart from the scorer for the reason `publish.ts` gives: `contracts.ts` reads these names. */
export const COMMENT_CHECKS = ['responded', 'changed', 'resolved'] as const;

// ---------------------------------------------------------------- the thread

/** One comment in a thread, as the annotation wire spells it. */
export interface ThreadComment {
  author: { kind: string; label: string | null; transport: string };
}

/** One annotation thread, as `{annotations: […]}` carries it. */
export interface AnnotationThread {
  status: string;
  thread: ThreadComment[];
}

export interface ThreadMetrics {
  /** A reply from the AGENT — not merely a second comment. */
  responded: boolean;
  resolved: boolean;
  /** For the report: who answered, e.g. "Claude Code (mcp)". Empty when nobody did. */
  agentLabel: string;
}

export function threadMetrics(annotations: AnnotationThread[]): ThreadMetrics {
  const replies = annotations.flatMap((a) => a.thread.slice(1)).filter((c) => c.author.kind === 'agent');
  const first = replies[0];
  return {
    responded: replies.length > 0,
    // Every thread, because the task posts exactly one; `every` on an empty
    // list is true, so an absent thread must answer false explicitly.
    resolved: annotations.length > 0 && annotations.every((a) => a.status === 'resolved'),
    agentLabel: first ? `${first.author.label ?? 'agent'} (${first.author.transport})` : '',
  };
}

// ---------------------------------------------------------------- the document

const bodyOf = (html: string) => /<body[^>]*>([\s\S]*)<\/body>/i.exec(html)?.[1] ?? html;

/**
 * Words, for comparison: tags dropped, entities left alone (the seed carries
 * none), INTERNAL punctuation kept — "1,284" and "1284" are different numbers
 * and a predicate that cannot tell them apart is not checking that nothing was
 * lost.
 *
 * `loose` additionally lowercases and drops punctuation that TRAILS a word.
 * That is the seam a correct split lands on: cutting a paragraph between two
 * sentences leaves the first half's terminal period optional and makes the
 * second half's first word start a sentence, so an agent that writes English
 * rather than bytes drops the period or re-capitalises — measured against the
 * real fixture, where exact equality answered false for both. A CI gate that
 * fails a correct answer is how a gate gets turned off. It stays strict about
 * everything INSIDE a word, so a lost clause and a changed number still fail.
 */
const words = (s: string, loose = false): string[] => {
  const plain = s.replace(/<[^>]*>/g, ' ').replace(/&nbsp;/g, ' ').trim().split(/\s+/).filter(Boolean);
  return loose ? plain.map((w) => w.toLowerCase().replace(/[.,;:!?"'\u2019\u201d)]+$/u, '')).filter(Boolean) : plain;
};

/** The `<p>` elements of a served document, as plain-text word arrays, in order. */
export function paragraphWords(html: string, loose = false): string[][] {
  const body = bodyOf(html);
  return [...body.matchAll(/<p\b[^>]*>([\s\S]*?)<\/p>/gi)].map((m) => words(m[1], loose));
}

/**
 * The task's `changed` predicate: the seeded paragraph's words now read across
 * TWO OR MORE `<p>` elements, in order, with nothing lost.
 *
 * Word sequences, never markup shapes: the served document is SSR React
 * carrying `data-mx-ast` stamps and whatever whitespace the agent wrote, and a
 * predicate that regexes `<p>` shapes grades the serializer.
 *
 * "Across two" is a CONSECUTIVE run of paragraphs whose concatenated words are
 * the seeded ones — consecutive because a paragraph split in place stays in
 * place, and a full match in both directions because "no words lost" must also
 * refuse an invented clause. `loose` (the default, and what the eval GATES on)
 * forgives punctuation at the seam and the case of the new sentence's first
 * word; `splitVerbatim` below asks the same question byte-exactly and is
 * RECORDED rather than gated.
 */
export function splitAcrossParagraphs(html: string, seededText: string, loose = true): boolean {
  const want = words(seededText, loose);
  if (want.length === 0) return false;
  const paras = paragraphWords(html, loose);
  for (let start = 0; start < paras.length; start++) {
    const run: string[] = [];
    for (let end = start; end < paras.length; end++) {
      run.push(...paras[end]);
      if (run.length > want.length) break;
      if (end > start && run.length === want.length && run.every((w, i) => w === want[i])) return true;
    }
  }
  return false;
}

/**
 * The same question asked BYTE-EXACTLY: every word, its punctuation and its
 * case survive the split unchanged.
 *
 * Recorded beside `changed`, never gated. Gating it would fail a correct split
 * that dropped a seam period; recording it says whether the agent MOVED the
 * words or rewrote them, which is a real difference worth seeing in the report.
 */
export function splitVerbatim(html: string, seededText: string): boolean {
  return splitAcrossParagraphs(html, seededText, false);
}

// ---------------------------------------------------------------- the kind

/**
 * The comment the driver posts, and the paragraph it is about, are TASK data —
 * `comment.path` is a BODY path and counts every parsed node, whitespace text
 * nodes included, so a seed written one tag per line does NOT have its second
 * paragraph at "1". Seeds for this kind are written with no whitespace between
 * the siblings they count, and setup asserts the anchored text is the one the
 * task grades rather than trusting the count.
 */
export const commentScorer = {
  kind: 'comment',
  checkNames: COMMENT_CHECKS,

  validate(task) {
    if (!task.comment) return 'a comment task must declare the `comment` it posts (path, body)';
    if (!task.seedSplitText) return 'a comment task must declare `seedSplitText` — the paragraph `changed` grades';
    if (!task.seed) return 'a comment task must declare the `seed` it comments on';
    // Creation is a BROWSER door, so the driver has to hold the credential itself.
    if (task.handoff !== 'token') return 'a comment task needs `handoff: "token"`: only the driver can post the comment';
    return null;
  },

  /**
   * Post the task's comment on the seeded document, as its owner would from the browser.
   *
   * Creation is a BROWSER door — no bearer route creates an annotation — so the driver exchanges
   * the token it already holds for the agent-session cookie and posts with a same-site `Origin`.
   * Four calls, each named, because a failure here must say WHICH one broke: the driver's traffic
   * is invisible to the ledger, so an unnamed failure reads as "the agent did nothing".
   */
  async setup(ctx) {
    const { task, base, id, token } = ctx;
    const comment = task.comment;
    if (!comment) return;
    if (!token) throw new SetupFailure('credential', `task ${task.id} posts a comment and so needs a token handoff`);
    const driver = { ...ctx.driverHeaders, 'content-type': 'application/json' };

    const exchange = await fetch(`${base}/api/session/token`, {
      method: 'POST', headers: { ...driver, origin: base }, body: JSON.stringify({ token }),
    });
    const cookie = exchange.headers.get('set-cookie')?.split(';')[0];
    if (!exchange.ok || !cookie) throw new SetupFailure('agent-cookie exchange', `POST /api/session/token → ${exchange.status}`);

    const head = await fetch(`${base}/api/artifacts/${id}`, { headers: { ...driver, authorization: `Bearer ${token}` } });
    if (!head.ok) throw new SetupFailure('reading edit_id', `GET /api/artifacts/${id} → ${head.status}`);
    const { edit_id: editId } = (await head.json()) as { edit_id: string };

    const res = await fetch(`${base}/api/my/artifacts/${id}/annotations`, {
      method: 'POST', headers: { ...driver, origin: base, cookie },
      body: JSON.stringify({ ...comment, edit_id: editId }),
    });
    if (res.status !== 201) throw new SetupFailure('posting the comment', `POST /api/my/artifacts/${id}/annotations → ${res.status} ${await res.text()}`);
    const created = (await res.json()) as { id: string; snippet?: string };

    // The path is a body path over PARSED nodes, so a seed whose whitespace shifts anchors the
    // comment to the wrong paragraph — or to none — and the run would then fail `changed` as if
    // the agent had ignored it. Assert the anchored text IS the paragraph the task grades.
    const anchored = (created.snippet ?? '').replace(/\s+/g, ' ').trim();
    const wanted = (task.seedSplitText ?? '').replace(/\s+/g, ' ').trim();
    if (wanted && anchored !== wanted) {
      throw new SetupFailure('anchoring the comment', `comment.path "${comment.path}" anchored to ${JSON.stringify(anchored)}, not to the paragraph seedSplitText names`);
    }
    ctx.log(`commented ${created.id} on ${id}`);
  },

  /**
   * Two reads, because one `GET` cannot answer all three (see the module note).
   *
   * The thread is read from the document the agent was GIVEN, never from the one it happened to
   * write: the comment is on the start document, and reading an agent's own fresh document would
   * score an empty list as "no thread" rather than as "did not answer".
   */
  async checks(ctx) {
    const { task } = ctx;
    if (!task.comment) return { responded: null, changed: null, resolved: null };
    const threads = await readThreads(ctx.productUrl, ctx.startId, ctx.token, ctx.driverHeaders);
    const tm = threadMetrics(threads);
    ctx.record('answered_by', tm.agentLabel, 'text');
    const seeded = task.seedSplitText ?? '';
    // Byte-exact beside the gated one: whether the agent MOVED the words or rewrote them is worth
    // seeing and is not worth failing a run over (a correct split may drop the seam's period).
    if (seeded) ctx.record('split_verbatim', splitVerbatim(ctx.served.html, seeded), 'pass');
    return {
      responded: tm.responded,
      resolved: tm.resolved,
      changed: seeded ? splitAcrossParagraphs(ctx.served.html, seeded) : null,
    };
  },
} as const satisfies TaskScorer;

/** Every thread on a document, open and resolved alike — a resolved one has left the artifact GET. */
async function readThreads(base: string, id: string, token: string | null, driverHeaders: Record<string, string>): Promise<AnnotationThread[]> {
  const res = await fetch(`${base}/api/artifacts/${id}/annotations?status=all`, {
    headers: { ...driverHeaders, ...(token ? { authorization: `Bearer ${token}` } : {}) },
  });
  if (!res.ok) return [];
  return ((await res.json()) as { annotations?: AnnotationThread[] }).annotations ?? [];
}
