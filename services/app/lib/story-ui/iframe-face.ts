/**
 * The STATIC face of `<Iframe>`: a box the managed frame's size, labelled —
 * what an inert render (a deck rail's preview) and the registry of static
 * faces (./registry) draw. The live face is the runtime's managed frame
 * (lib/story-runtime/kit/iframe).
 */
import { createElement, type ComponentType } from 'react';
import { managedFrameLayout } from '@/lib/story/managed-frame-layout';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const IframeFace: ComponentType<any> = props => {
  const { label, pixels } = managedFrameLayout(props.title, props.height);
  return createElement('div', { id: props.id, className: props.className, 'data-mx-ast': props['data-mx-ast'], 'data-mx-managed-frame': '', 'aria-label': label, style: { height: pixels, width: '100%' } }, createElement('div', { style: { height: '100%' } }));
};
