/**
 * COMPATIBILITY FOR LIVE PAGES, isolated here: names the @afbin/apollo runtime still answers only because published
 * pages call them. Live pages published before 2026-11-04 call onBackendChange (49 on production); authors are taught
 * onResolverChange only. Delete when no live page uses it.
 *
 * browser-client.ts re-exports this module with `export *`, so no skill, doc or type surface names the old name; the
 * retired-phrasing guard allows it in this file only.
 */
import {onResolverChange} from './browser-reader';

/** @deprecated The old name of onResolverChange, for pages already published with it. */
export const onBackendChange = onResolverChange;
