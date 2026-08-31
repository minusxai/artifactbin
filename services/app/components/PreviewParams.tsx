'use client';

/**
 * Mounts the two carriers that keep `?v=2` alive in a browser
 * (lib/features/install): the fetch patch and the link rewriter.
 *
 * In the ROOT layout, deliberately — every page reaches `/api/` and every page
 * has links, including the ones outside the (shell) group. It renders nothing
 * and installs nothing when the URL carries no flag (the installers check the
 * live location on every call), so an ordinary visit pays one effect and no
 * behaviour change at all.
 */
import { useEffect } from 'react';
import { installPreviewFetch, installPreviewLinks } from '@/lib/features/install';

export default function PreviewParams() {
  useEffect(() => {
    const offFetch = installPreviewFetch(window);
    const offLinks = installPreviewLinks(document);
    return () => { offLinks(); offFetch(); };
  }, []);
  return null;
}
