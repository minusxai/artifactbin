/**
 * What an agent is told at the moment it authors — the MCP tool schema.
 *
 * An MCP client never fetches the docs. It connects over the protocol, so the
 * tool schema is the ONLY instruction surface it sees. Guidance that lives in a
 * docs page is guidance an MCP agent has no reason to go and read.
 *
 * That is not hypothetical: told only "Tailwind classes via className", ChatGPT
 * reached for its own built-in slide skill and published a deck of bare
 * <section>/<h1>/<ul> with zero className attributes. We rendered exactly what
 * it wrote — a wall of unstyled text. Nothing in the schema told it that bare
 * HTML was a mistake, or what the alternative looked like.
 *
 * So the non-negotiables live here, inline, and the reference is named by a
 * path the agent can actually fetch. Kept deliberately terse: a description
 * nobody skims is worth as much as one nobody can reach.
 */
import { PUBLIC_BASE_URL } from './config';

/** The single rule whose absence produced an unstyled document. */
export const MARKUP_STYLE_RULE =
  'EVERY element needs Tailwind utilities in className — bare HTML renders completely unstyled.';

/**
 * The rule whose absence produced a report that contradicted its own data.
 *
 * Codex published a revenue report whose prose read "totals 19400" beside a
 * <Number> that computed 19,300 from the same rows. The embed was right; the
 * arithmetic in the agent's head was not. Both surfaces described what <Number>
 * IS and neither said when to reach for it, so the agent treated it as a
 * decorative alternative to typing the figure out.
 *
 * A hand-typed figure is also frozen: the dataset can be re-uploaded and the
 * prose still says the old total. That is worse than an ugly page — it is a
 * document that lies quietly, which is the failure this whole tier exists to
 * prevent.
 */
export const COMPUTED_FIGURE_RULE =
  'NEVER type a figure into prose that the data can compute — <Number> inline instead; ' +
  'typed figures go stale and are often simply wrong.';

/**
 * Agents discover the CSV/sheet forms here or not at all — the schema is the
 * only surface an MCP client reads (the lesson from the styling bug).
 */
export const DATASET_FIELD_GUIDANCE =
  'dataset tier: one flat table. Accepts a JSON array of flat objects, OR raw CSV text ' +
  '(types are inferred per column — leading zeros stay text, so zip codes survive). ' +
  'For a public Google Sheet use `sheetUrl` instead. Returns an artifact id to reference as ref:<id>.';

export const SHEET_URL_FIELD_GUIDANCE =
  'A PUBLIC Google Sheets link ("anyone with the link can view"). ' +
  // ChatGPT refused a sheet import and asked the user to connect Google Drive,
  // believing it had to read the sheet itself. It does not: pass the URL and
  // artifactbin fetches it server-side. Say so first, before anything else.
  'YOU DO NOT NEED ACCESS TO THE SHEET AND MUST NOT FETCH IT YOURSELF — pass the URL here and artifactbin ' +
  'downloads it server-side. No Google account, connector or file access is required on your side. ' +
  'The #gid in the URL selects the tab. Private sheets are rejected with a clear error — there is no sign-in.';

/**
 * Same lesson as SHEET_URL: an agent that believes it must fetch the asset
 * itself will refuse, or waste a tool call downloading bytes it cannot post.
 * Lead with "you do not need to fetch it".
 */
export const IMAGE_URL_FIELD_GUIDANCE =
  'image tier from a URL: any public image on the web. ' +
  'YOU DO NOT NEED TO DOWNLOAD IT — pass the URL and artifactbin fetches it server-side, ' +
  'stores a copy, and serves it from its own origin (the document never hotlinks). ' +
  'You can also just write <img src="https://…"> in markup: publish imports a copy and ' +
  'LEAVES YOUR URL in the document. Returns an artifact id to reference as ref:<id>.';

/**
 * The PDF tier's two shapes. Same lesson as the two above — an agent that
 * believes it must fetch or re-encode the file will refuse or waste a call —
 * plus the one thing only this tier needs said: a PDF is not a document you
 * publish, it is a FILE a document links, and <File> is the position that
 * links it.
 */
export const PDF_FIELD_GUIDANCE =
  'pdf tier: a base64 data: URL (data:application/pdf;base64,…). Stored as-is, never re-encoded, '
  + 'and served inline so a reader opens it in their browser\'s own viewer. '
  + 'Link it from a document with <File src="ref:<id>" /> — a card showing the name, size and page count. '
  + 'Returns an artifact id to reference as ref:<id>.';

export const PDF_URL_FIELD_GUIDANCE =
  'pdf tier from a URL: any public PDF on the web. '
  + 'YOU DO NOT NEED TO DOWNLOAD IT — pass the URL and artifactbin fetches it server-side, '
  + 'stores a copy, and serves it from its own origin (the card never links the original host). '
  + 'You can also just write <File src="https://…/paper.pdf" /> in markup: publish imports it and '
  + 'LEAVES YOUR URL in the document. Returns an artifact id to reference as ref:<id>.';

export const CSV_URL_FIELD_GUIDANCE =
  'dataset tier from a URL: any PUBLIC CSV link (S3, raw GitHub, a data portal — not only Google Sheets). ' +
  'YOU DO NOT NEED TO DOWNLOAD IT — pass the URL and artifactbin fetches it server-side. ' +
  'Types are inferred per column, same as the dataset field.';

export const MARKUP_FIELD_GUIDANCE = [
  'THE document tier: story JSX over the shadcn kit; data is declared in <Helmet>, bound by $name.',
  `STYLING IS NOT OPTIONAL. ${MARKUP_STYLE_RULE}`,
  'Open with <div data-design="tw" className="@container …"> and style every child (spacing, type, colour).',
  'Inline style=/onClick= rejected: ONE <Helmet> carries <style> (theme vars on :root) and <script>, which RUNS — use addEventListener.',
  'Prefer theme tokens (text-muted-foreground, bg-muted) over hex so themes apply.',
  `Read ${PUBLIC_BASE_URL}/docs/artifactbin/references/markup.md for the vocabulary first.`,
  'Data: <Helmet><Query name="q">{`select … from ref_<datasetId>`}</Query></Helmet>, then <Question data="$q" viz={{"kind":"vega-lite","spec":{…}}} />.',
  'Filters: <Value name="x" /> in Helmet, <select value="$x" options="$q" /> in the body, $x in SQL. data="ref:…" and Param are RETIRED.',
  COMPUTED_FIGURE_RULE,
].join(' ');
