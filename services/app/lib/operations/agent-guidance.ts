

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
