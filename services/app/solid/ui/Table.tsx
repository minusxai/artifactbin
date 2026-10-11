/* @jsxImportSource solid-js */
/**
 * THE DATA TABLE. A native <table> (so rows, column headers and cells keep their roles) in a horizontally
 * scrolling frame, named by `label`. `density` sets every cell's padding and text: `md` for a page's table,
 * `sm` for one inside a card. TableHead draws the header row of micro-label column headers (`scope="col"`);
 * TableRow is divided from the row above and highlights on hover unless `interactive={false}` (an empty-state
 * row). Every cell takes `align`, `colSpan` and native attributes; `class` is for layout (widths, responsive
 * hiding), never look.
 */
import { createContext, splitProps, useContext, type JSX } from 'solid-js';

type Density = 'md' | 'sm';
const DensityContext = createContext<() => Density>((): Density => 'md');
const CELL: Record<Density, string> = { md: 'px-4 py-2.5', sm: 'px-3 py-2' };
const TEXT: Record<Density, string> = { md: 'text-sm', sm: 'text-xs' };
const ALIGN = { left: 'text-left', center: 'text-center', right: 'text-right' } as const;

export function Table(props: { label?: string; density?: Density; fixed?: boolean; class?: string; children: JSX.Element }): JSX.Element {
  const density = () => props.density ?? 'md';
  return <div class={`min-w-0 overflow-x-auto ${props.class ?? ''}`}>
    <table aria-label={props.label} class={`w-full border-collapse text-left font-sans text-fg ${TEXT[density()]} ${props.fixed ? 'table-fixed' : ''}`}>
      <DensityContext.Provider value={density}>{props.children}</DensityContext.Provider>
    </table>
  </div>;
}

export function TableHead(props: { class?: string; children: JSX.Element }): JSX.Element {
  return <thead class={props.class}><tr>{props.children}</tr></thead>;
}

export function TableBody(props: { children: JSX.Element }): JSX.Element {
  return <tbody>{props.children}</tbody>;
}

export function TableRow(props: Omit<JSX.HTMLAttributes<HTMLTableRowElement>, 'class'> & { interactive?: boolean; class?: string }): JSX.Element {
  const [own, rest] = splitProps(props, ['interactive', 'class']);
  return <tr {...rest} class={`border-t border-edge ${own.interactive === false ? '' : 'transition-colors hover:bg-raised'} ${own.class ?? ''}`} />;
}

type CellProps<T> = Omit<T, 'class' | 'align'> & { align?: keyof typeof ALIGN; class?: string };

export function TableHeaderCell(props: CellProps<JSX.ThHTMLAttributes<HTMLTableCellElement>>): JSX.Element {
  const density = useContext(DensityContext) ?? ((): Density => 'md');
  const [own, rest] = splitProps(props, ['align', 'class']);
  return <th scope="col" {...rest} class={`${CELL[density()]} whitespace-nowrap font-mono text-micro font-normal uppercase tracking-[0.14em] text-faint ${ALIGN[own.align ?? 'left']} ${own.class ?? ''}`} />;
}

export function TableCell(props: CellProps<JSX.TdHTMLAttributes<HTMLTableCellElement>>): JSX.Element {
  const density = useContext(DensityContext) ?? ((): Density => 'md');
  const [own, rest] = splitProps(props, ['align', 'class']);
  return <td {...rest} class={`${CELL[density()]} align-middle ${ALIGN[own.align ?? 'left']} ${own.class ?? ''}`} />;
}
