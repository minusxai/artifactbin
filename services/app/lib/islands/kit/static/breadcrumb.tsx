/* @jsxImportSource solid-js */
import type { JSX } from 'solid-js';

type P = Omit<JSX.HTMLAttributes<HTMLElement>, 'ref'>;
export function Breadcrumb(props: P) { return <nav aria-label="breadcrumb" data-slot="breadcrumb" {...props} />; }
export function BreadcrumbList(props: P) { return <ol data-slot="breadcrumb-list" {...props} />; }
export function BreadcrumbItem(props: P) { return <li data-slot="breadcrumb-item" {...props} />; }
export function BreadcrumbLink(props: P) { return <a data-slot="breadcrumb-link" {...props} />; }
export function BreadcrumbPage(props: P) { return <span data-slot="breadcrumb-page" role="link" aria-disabled="true" aria-current="page" {...props} />; }
export function BreadcrumbSeparator(props: P) { return <li data-slot="breadcrumb-separator" role="presentation" aria-hidden="true" {...props}>{props.children ?? <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m9 18 6-6-6-6" /></svg>}</li>; }
export function BreadcrumbEllipsis(props: P) { return <span data-slot="breadcrumb-ellipsis" role="presentation" aria-hidden="true" {...props}><svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" class="size-4"><circle cx="12" cy="12" r="1" /><circle cx="19" cy="12" r="1" /><circle cx="5" cy="12" r="1" /></svg><span class="sr-only">More</span></span>; }
