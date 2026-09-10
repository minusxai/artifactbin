/** Shared field guidance for HTTP validation and bundled local help. */
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
 * concise description carried by the local operation reference.
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
  'Static JSX document. Prefer native kit layouts, charts, controls, conditions and Dialog; reserve <Iframe> for isolated DOM-script/canvas widgets.',
  MARKUP_STYLE_RULE,
  'Start with <div data-design="tw" className="@container …">. Use theme tokens, e.g. bg-muted.',
  'Inline style=/onClick= rejected. ONE <Helmet> holds <style>; its <script> runs without parent DOM access.',
  'Read `afbin help markup` or the installed references/markup.md first.',
  'Data: <Query name="q" source="ref:<id>">{`select … from public.rows`}</Query> in Helmet, then <Question data="$q" viz={{kind:"vega-lite",spec:{…}}} />.',
  'Filters: <Value name="x" /> in Helmet, <select value="$x" options="$q" /> in the body; $x in SQL.',
  COMPUTED_FIGURE_RULE,
].join(' ');
