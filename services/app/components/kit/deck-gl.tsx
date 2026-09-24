/**
 * `<DeckGL>` — the story kit's map. This shell is all the reader's first paint
 * carries: deck.gl, MapLibre and h3-js load as one lazy chunk
 * (./deck-gl-engine) only when a document actually holds a map. The contract
 * it renders is lib/viz/deck-spec.
 */
import { useEffect, useState, type ComponentType } from 'react';
import type { DeckEngineProps } from './deck-gl-engine';

export type DeckGLMapProps = Omit<DeckEngineProps, 'height'> & { height?: number | string };

const DEFAULT_HEIGHT = 420;

export function DeckGLMap(props: DeckGLMapProps) {
  const [Engine, setEngine] = useState<ComponentType<DeckEngineProps> | null>(null);
  useEffect(() => {
    let live = true;
    void import('./deck-gl-engine').then(m => { if (live) setEngine(() => m.DeckEngine); });
    return () => { live = false; };
  }, []);
  const height = typeof props.height === 'number' ? props.height : Number.parseInt(String(props.height ?? DEFAULT_HEIGHT), 10) || DEFAULT_HEIGHT;
  if (!Engine) return <div className="w-full rounded-md bg-muted" style={{ height }} aria-busy="true" aria-label={props.title ?? 'Map loading'} />;
  return <Engine {...props} height={height} />;
}
