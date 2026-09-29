/* @jsxImportSource solid-js */
import type { JSX } from 'solid-js';

type P = Omit<JSX.HTMLAttributes<HTMLElement>, 'ref'>;
export function Table(props: P) { return <div data-slot="table-container" class="relative w-full overflow-x-auto"><table data-slot="table" {...props} /></div>; }
export function TableHeader(props: P) { return <thead data-slot="table-header" {...props} />; }
export function TableBody(props: P) { return <tbody data-slot="table-body" {...props} />; }
export function TableFooter(props: P) { return <tfoot data-slot="table-footer" {...props} />; }
export function TableRow(props: P) { return <tr data-slot="table-row" {...props} />; }
export function TableHead(props: P) { return <th data-slot="table-head" {...props} />; }
export function TableCell(props: P) { return <td data-slot="table-cell" {...props} />; }
export function TableCaption(props: P) { return <caption data-slot="table-caption" {...props} />; }
