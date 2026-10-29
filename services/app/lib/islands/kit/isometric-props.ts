import type { JSX } from 'solid-js';
import type { IsometricSpec } from '@/lib/jsx';

/** Both server and browser shells keep geometry attributes off their DOM wrapper. */
export const ISOMETRIC_PROPS = ['parts', 'title', 'width', 'height', 'azimuth', 'elevation', 'spread', 'angle', 'flow', 'appearance', 'motion', 'children'] as const;
export type IsometricProps = IsometricSpec & JSX.HTMLAttributes<HTMLDivElement>;
