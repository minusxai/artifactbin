'use client';

/**
 * The renderer's half of node identity (lib/story-ui/node-identity): remember
 * the tree that was rendered last, so the next one can inherit its keys.
 *
 * The served document (StoryRuntimeApp) uses it on both ends — the server's
 * render and the browser's — and on every later change, because a document
 * that re-parses would otherwise hand React a tree whose keys shifted under it:
 * an edit to one paragraph would remount every sibling after it, and the charts
 * below them.
 *
 * The ref is written during render on purpose: the keys ARE this render's
 * output, and the next render needs the tree they were computed for. That is
 * safe here because the computation is pure and idempotent — re-running it
 * with the same nodes aligns the tree with itself and returns the same keys,
 * which is what makes StrictMode's double render a no-op.
 */
import { useMemo, useRef } from 'react';
import type { JsxNode } from '@/lib/jsx';
import { assignNodeKeys, type KeyedTree, type NodeKeys } from './node-identity';

export function useNodeKeys(nodes: JsxNode[]): NodeKeys {
  const previous = useRef<KeyedTree | null>(null);
  return useMemo(() => {
    const keys = assignNodeKeys(nodes, previous.current);
    previous.current = { nodes, keys };
    return keys;
  }, [nodes]);
}
