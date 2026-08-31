'use client';

/**
 * Mixpanel bootstrap. Generic product analytics: autocapture (clicks, form
 * submits), SPA pageviews, session properties — configured entirely by the
 * server (lib/config.ts) and passed down as props, so no env var is read
 * outside config and a machine with no MIXPANEL_TOKEN ships a no-op.
 *
 * Mounted from the ROOT layout: every page, artifact readers included. The
 * reader's first load is guarded weight (see reader-bundle-hygiene), so the
 * library enters through a dynamic import after hydration — the same
 * boundary that keeps Monaco and vega out of the critical path. That lazy
 * import is a sanctioned exception to the no-dynamic-imports convention,
 * documented here on purpose.
 */
import { useEffect } from 'react';

type Mixpanel = (typeof import('mixpanel-browser'))['default'];

/**
 * The init → identify gate. mixpanel-browser HARD-ERRORS on pre-init calls
 * (posthog-js queued them silently), and React runs child effects first — the
 * shell layout's Identify mounts before the root layout's init. So init
 * resolves this promise and Identify awaits it; when analytics is off (no
 * token) it never resolves and identify correctly never fires.
 */
let resolveReady!: (m: Mixpanel) => void;
const ready = new Promise<Mixpanel>((r) => {
  resolveReady = r;
});

export default function MixpanelClient({ token, host }: { token: string | null; host: string }) {
  useEffect(() => {
    if (!token) return;
    void import('mixpanel-browser').then(({ default: mixpanel }) => {
      mixpanel.init(token, {
        api_host: host,
        // Autocapture (clicks, form submits, rage clicks) + history-change
        // pageviews cover the App Router's SPA navigations — posthog parity.
        autocapture: true,
        track_pageview: 'full-url',
        persistence: 'localStorage',
        // Session replay: record every session, with page text visible —
        // the default record_mask_text_selector ('*') masks every text node.
        // Form inputs stay masked regardless of this selector.
        record_sessions_percent: 100,
        record_mask_text_selector: '',
      });
      resolveReady(mixpanel);
    });
  }, [token, host]);
  return null;
}

/**
 * Attach the signed-in user to the Mixpanel profile. Rendered by the shell
 * layout (which already resolved the session for the header — no extra
 * work); artifact readers stay anonymous. Safe to render before/without
 * init: it waits on the gate above and never fires while analytics is off.
 */
export function MixpanelIdentify({ userId, email }: { userId: string; email: string | null }) {
  useEffect(() => {
    let cancelled = false;
    void ready.then((mixpanel) => {
      if (cancelled) return;
      mixpanel.identify(userId);
      if (email) mixpanel.people.set({ $email: email });
    });
    return () => {
      cancelled = true;
    };
  }, [userId, email]);
  return null;
}
