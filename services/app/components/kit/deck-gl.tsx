// SPIKE (M0): <DeckGL> kit component — a thin shell; the engine is a lazy chunk.
import { useEffect, useState, type ComponentType } from 'react';

type EngineProps = Parameters<typeof import('./deck-gl-engine').DeckEngine>[0];

export function DeckGLMap(props: Omit<EngineProps, 'height'> & { height?: number | string }) {
  const [Engine, setEngine] = useState<ComponentType<EngineProps> | null>(null);
  useEffect(() => { void import('./deck-gl-engine').then(m => setEngine(() => m.DeckEngine)); }, []);
  const height = typeof props.height === 'number' ? props.height : Number.parseInt(String(props.height ?? '420'), 10) || 420;
  if (!Engine) return <div style={{ height }} aria-busy="true" aria-label="Map loading" />;
  return <Engine {...props} height={height} />;
}
