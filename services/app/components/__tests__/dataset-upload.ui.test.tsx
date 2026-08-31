/**
 * The human path into the data tier.
 *
 * What matters here is not that the POST happens but WHAT comes back to the
 * user: an artifact id alone cannot be used. To write a <Question> you need the
 * `ref:` form and the column names, so both are asserted.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import DatasetUpload from '../DatasetUpload';

let posts: Array<{ url: string; body: Record<string, unknown>; auth?: string }> = [];
let fetched: string[] = [];
let reply: { ok: boolean; body: Record<string, unknown> };
let previewRows: Record<string, unknown>[];
/** Does this browser already hold a token (as its httpOnly cookie)? */
let credentialed = false;

beforeEach(() => {
  posts = [];
  fetched = [];
  reply = { ok: true, body: { id: 'abc123', url: 'http://x/a/abc123', title: 'sales', rowCount: 2, columns: [{ name: 'month', type: 'string' }, { name: 'revenue', type: 'number' }] } };
  previewRows = [{ month: '2026-01', revenue: 120 }, { month: '2026-02', revenue: null }];
  localStorage.clear();
  credentialed = false;
  vi.stubGlobal('fetch', (async (url: string, init: RequestInit) => {
    fetched.push(String(url));
    // The credential probe: an authorized read means this browser already
    // holds a token (as its httpOnly cookie), so no mint is needed.
    if (String(url) === '/api/my/artifacts' && (init?.method ?? 'GET') === 'GET') {
      return new Response(JSON.stringify({ artifacts: [] }), { status: credentialed ? 200 : 401 });
    }
    // The mint the component falls back to when the browser has no credential.
    if (String(url).includes('/api/tokens/anonymous')) {
      posts.push({ url: String(url), body: {} });
      return new Response(JSON.stringify({ token: 'mx_minted' }), { status: 201 });
    }
    // The exchange: the minted secret goes straight to the server and comes
    // back as a cookie — the page keeps nothing.
    if (String(url) === '/api/session/token') {
      posts.push({ url: String(url), body: JSON.parse(String(init.body)) });
      credentialed = true;
      return new Response(JSON.stringify({ ok: true }), { status: 200 });
    }
    // The preview fetch, which pulls a corner of the stored rows.
    if (String(url).includes('/raw')) {
      return new Response(JSON.stringify(previewRows), { status: 200 });
    }
    posts.push({ url: String(url), body: JSON.parse(String(init.body)), auth: (init.headers as Record<string, string>)?.Authorization });
    return new Response(JSON.stringify(reply.body), { status: reply.ok ? 201 : 400 });
  }) as unknown as typeof fetch);
  vi.stubGlobal('navigator', { ...navigator, clipboard: { writeText: vi.fn() } });
});

afterEach(() => vi.unstubAllGlobals());

const chooseFile = (text: string, name = 'sales.csv') => {
  const input = screen.getByLabelText('CSV file') as HTMLInputElement;
  const file = new File([text], name, { type: 'text/csv' });
  // jsdom's File.text() is unreliable across versions; pin it.
  Object.defineProperty(file, 'text', { value: async () => text });
  fireEvent.change(input, { target: { files: [file] } });
};

describe('uploading a CSV', () => {
  it('posts the file TEXT as a dataset, titled from the filename', async () => {
    render(<DatasetUpload />);
    chooseFile('month,revenue\n2026-01,120');
    // posts[0..1] are the mint and the exchange; find the upload itself.
    await waitFor(() => expect(posts.some((p) => p.url === '/api/my/artifacts')).toBe(true));
    expect(posts.find((p) => p.url === '/api/my/artifacts')!.body).toEqual({ title: 'sales', dataset: 'month,revenue\n2026-01,120' });
  });

  it('shows the ref: form and the columns — what you need to write a <Question>', async () => {
    render(<DatasetUpload />);
    chooseFile('month,revenue\n2026-01,120');
    expect(await screen.findByLabelText('Copy dataset reference')).toHaveTextContent('ref:abc123');
    expect(screen.getByLabelText('Dataset columns')).toHaveTextContent('revenue:number');
  });

  it('copies the reference, not the bare id', async () => {
    render(<DatasetUpload />);
    chooseFile('a\n1');
    fireEvent.click(await screen.findByLabelText('Copy dataset reference'));
    expect(navigator.clipboard.writeText).toHaveBeenCalledWith('ref:abc123');
  });
});

describe('importing a public sheet', () => {
  it('posts the URL as sheetUrl', async () => {
    render(<DatasetUpload />);
    fireEvent.change(screen.getByLabelText('Google Sheet URL'), { target: { value: 'https://docs.google.com/spreadsheets/d/abc/edit' } });
    fireEvent.click(screen.getByLabelText('Import sheet'));
    await waitFor(() => expect(posts.some((p) => p.url === '/api/my/artifacts')).toBe(true));
    expect(posts.find((p) => p.url === '/api/my/artifacts')!.body.sheetUrl).toBe('https://docs.google.com/spreadsheets/d/abc/edit');
  });

  it('cannot be submitted empty', () => {
    render(<DatasetUpload />);
    expect((screen.getByLabelText('Import sheet') as HTMLButtonElement).disabled).toBe(true);
  });
});

describe('errors', () => {
  it('surfaces the ingest message verbatim — they are written for humans', async () => {
    reply = { ok: false, body: { error: 'invalid_dataset', code: 'sheet_not_public', details: ['That sheet is not publicly readable. Share it as "anyone with the link can view".'] } };
    render(<DatasetUpload />);
    fireEvent.change(screen.getByLabelText('Google Sheet URL'), { target: { value: 'https://docs.google.com/spreadsheets/d/abc/edit' } });
    fireEvent.click(screen.getByLabelText('Import sheet'));
    expect(await screen.findByLabelText('Upload error')).toHaveTextContent('not publicly readable');
  });

  it('does not show a stale result alongside an error', async () => {
    render(<DatasetUpload />);
    chooseFile('a\n1');
    await screen.findByLabelText('Uploaded dataset');
    reply = { ok: false, body: { details: ['Dataset has 60000 rows; the limit is 50000.'] } };
    chooseFile('a\n1', 'big.csv');
    expect(await screen.findByLabelText('Upload error')).toHaveTextContent('limit is 50000');
  });
});


describe('authorization — the case that shipped broken', () => {
  /**
   * The upload endpoint needs a credential. A fresh browser has none, and the
   * component used to send no Authorization header at all, so the user saw a
   * bare "unauthorized". The credential now lives in an httpOnly cookie, so
   * what these pin is the SHAPE of getting one: probe, mint only if needed,
   * exchange it for the cookie, and never put a secret in a header the page
   * had to keep.
   */
  it('mints a token when the browser has none, and exchanges it for the cookie', async () => {
    render(<DatasetUpload />);
    chooseFile('a\n1');
    await waitFor(() => expect(posts.some((p) => p.url === '/api/my/artifacts')).toBe(true));
    expect(posts[0].url).toContain('/api/tokens/anonymous');
    expect(posts[1]).toMatchObject({ url: '/api/session/token', body: { token: 'mx_minted' } });
    // The upload rides the cookie — no bearer header, nothing for a script to steal.
    expect(posts.find((p) => p.url === '/api/my/artifacts')!.auth).toBeUndefined();
  });

  it('does not mint when the browser already holds a credential', async () => {
    credentialed = true;
    render(<DatasetUpload />);
    chooseFile('a\n1');
    await waitFor(() => expect(posts.some((p) => p.url === '/api/my/artifacts')).toBe(true));
    expect(posts.some((p) => p.url.includes('/api/tokens/anonymous'))).toBe(false);
  });

  it('takes the same path on the sheet import', async () => {
    render(<DatasetUpload />);
    fireEvent.change(screen.getByLabelText('Google Sheet URL'), { target: { value: 'https://docs.google.com/spreadsheets/d/abc/edit' } });
    fireEvent.click(screen.getByLabelText('Import sheet'));
    await waitFor(() => expect(posts.some((p) => p.url === '/api/my/artifacts')).toBe(true));
    expect(posts.some((p) => p.url === '/api/session/token')).toBe(true);
  });
});

describe('truncation is visible, never silent', () => {
  it('says how many rows were kept when the source had more', async () => {
    reply = { ok: true, body: { id: 'bigSet1', title: 'big', rowCount: 10000, totalRows: 200000, truncated: true, columns: [] } };
    render(<DatasetUpload />);
    chooseFile('a\n1');
    expect(await screen.findByLabelText('Truncation notice')).toHaveTextContent('first 10,000 of 200,000');
  });

  it('says nothing when the whole source was kept', async () => {
    render(<DatasetUpload />);
    chooseFile('a\n1');
    await screen.findByLabelText('Uploaded dataset');
    expect(screen.queryByLabelText('Truncation notice')).toBeNull();
  });
});

describe('a failed token mint explains itself', () => {
  it('names rate limiting rather than showing a generic failure', async () => {
    vi.stubGlobal('fetch', (async (url: string) => {
      // No credential yet (the probe 401s), and the mint is rate limited.
      if (String(url) === '/api/my/artifacts') return new Response('{}', { status: 401 });
      if (String(url).includes('/api/tokens/anonymous')) return new Response('{}', { status: 429 });
      return new Response('{}', { status: 201 });
    }) as unknown as typeof fetch);
    render(<DatasetUpload />);
    chooseFile('a\n1');
    expect(await screen.findByLabelText('Upload error')).toHaveTextContent(/Too many new sessions/);
  });
});


describe('the preview table', () => {
  it('shows the rows as a table with typed headers', async () => {
    render(<DatasetUpload />);
    chooseFile('month,revenue\n2026-01,120');
    const table = await screen.findByLabelText('Dataset preview');
    expect(table).toHaveTextContent('month');
    expect(table).toHaveTextContent('revenue');
    expect(table).toHaveTextContent('2026-01');
    expect(table).toHaveTextContent('120');
  });

  // The preview is addressed by the created artifact's id — the ONE identifier
  // the create response carries. Nothing is parsed back out of the returned url.
  it('reads the rows from /a/<id>/raw', async () => {
    render(<DatasetUpload />);
    chooseFile('month,revenue\n2026-01,120');
    await screen.findByLabelText('Dataset preview');
    expect(fetched).toContain('/a/abc123/raw');
  });

  it('renders a null as MISSING, not the word "null"', async () => {
    render(<DatasetUpload />);
    chooseFile('a\n1');
    const table = await screen.findByLabelText('Dataset preview');
    expect(table.textContent).not.toMatch(/null/);
    expect(table).toHaveTextContent('—');
  });

  it('caps the preview at 100 rows however many are stored', async () => {
    previewRows = Array.from({ length: 500 }, (_, i) => ({ month: `m${i}`, revenue: i }));
    reply = { ok: true, body: { id: 'bigSet1', url: 'http://x/a/bigSet1', title: 'big', rowCount: 10000, columns: [{ name: 'month', type: 'string' }, { name: 'revenue', type: 'number' }] } };
    render(<DatasetUpload />);
    chooseFile('a\n1');
    await screen.findByLabelText('Dataset preview');
    // Header row plus exactly 100 body rows — a preview, not a browser.
    expect(document.querySelectorAll('[aria-label="Dataset preview"] tbody tr')).toHaveLength(100);
    expect(screen.getByLabelText('Preview notice')).toHaveTextContent('100 of 10,000');
  });

  it('still shows the summary when the preview cannot be fetched', async () => {
    vi.stubGlobal('fetch', (async (url: string, init: RequestInit) => {
      if (String(url).includes('/api/tokens/anonymous')) return new Response(JSON.stringify({ token: 'mx_t' }), { status: 201 });
      if (String(url).includes('/raw')) return new Response('nope', { status: 500 });
      return new Response(JSON.stringify(reply.body), { status: 201 });
    }) as unknown as typeof fetch);
    render(<DatasetUpload />);
    chooseFile('a\n1');
    expect(await screen.findByLabelText('Uploaded dataset')).toBeTruthy();
    expect(screen.queryByLabelText('Dataset preview')).toBeNull();
  });
});

describe('naming an import', () => {
  it('uses the filename when no name is typed', async () => {
    render(<DatasetUpload />);
    chooseFile('a\n1', 'quarterly-sales.csv');
    await waitFor(() => expect(posts.some((p) => p.url === '/api/my/artifacts')).toBe(true));
    expect(posts.find((p) => p.url === '/api/my/artifacts')!.body.title).toBe('quarterly-sales');
  });

  it('prefers a typed name over the filename', async () => {
    render(<DatasetUpload />);
    fireEvent.change(screen.getByLabelText('Dataset name'), { target: { value: 'Q3 revenue' } });
    chooseFile('a\n1', 'export_final_v2.csv');
    await waitFor(() => expect(posts.some((p) => p.url === '/api/my/artifacts')).toBe(true));
    expect(posts.find((p) => p.url === '/api/my/artifacts')!.body.title).toBe('Q3 revenue');
  });

  it('identifies a sheet by its id rather than calling every import the same thing', async () => {
    render(<DatasetUpload />);
    fireEvent.change(screen.getByLabelText('Google Sheet URL'), { target: { value: 'https://docs.google.com/spreadsheets/d/12Na1sCxpkqFjV2/edit?gid=7' } });
    fireEvent.click(screen.getByLabelText('Import sheet'));
    await waitFor(() => expect(posts.some((p) => p.url === '/api/my/artifacts')).toBe(true));
    const title = posts.find((p) => p.url === '/api/my/artifacts')!.body.title as string;
    expect(title).toContain('12Na1sCx');
    expect(title).not.toBe('Sheet import');
  });
});
