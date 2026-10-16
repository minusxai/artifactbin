/* @jsxImportSource solid-js */
import { splitProps } from 'solid-js';
import { IsometricDrawing } from './isometric-drawing';
import { ISOMETRIC_PROPS, type IsometricProps } from './isometric-props';

/** The server emits the complete drawing; the browser shell adopts this same wrapper. */
export function Isometric(props: IsometricProps) {
  const [drawing, rest] = splitProps(props, ISOMETRIC_PROPS);
  return <div {...rest} data-slot="isometric"><IsometricDrawing {...drawing} /></div>;
}
