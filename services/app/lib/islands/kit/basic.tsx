/* @jsxImportSource solid-js */
import type { JSX } from 'solid-js';

type DivProps = JSX.HTMLAttributes<HTMLDivElement>;
type SpanProps = JSX.HTMLAttributes<HTMLSpanElement>;

export function Badge(props: SpanProps & { variant?: string }) { const { variant = 'default', ...rest } = props; return <span data-slot="badge" data-variant={variant} {...rest} />; }
export function Alert(props: DivProps & { variant?: string }) { const { variant: _variant, ...rest } = props; return <div data-slot="alert" role="alert" {...rest} />; }
export function AlertTitle(props: DivProps) { return <div data-slot="alert-title" {...props} />; }
export function AlertDescription(props: DivProps) { return <div data-slot="alert-description" {...props} />; }
export function Card(props: DivProps) { return <div data-slot="card" {...props} />; }
export function CardHeader(props: DivProps) { return <div data-slot="card-header" {...props} />; }
export function CardTitle(props: DivProps) { return <div data-slot="card-title" {...props} />; }
export function CardDescription(props: DivProps) { return <div data-slot="card-description" {...props} />; }
export function CardAction(props: DivProps) { return <div data-slot="card-action" {...props} />; }
export function CardContent(props: DivProps) { return <div data-slot="card-content" {...props} />; }
export function CardFooter(props: DivProps) { return <div data-slot="card-footer" {...props} />; }
export function Button(props: JSX.ButtonHTMLAttributes<HTMLButtonElement> & { variant?: string; size?: string; run?: unknown; set?: unknown; args?: unknown }) {
  const { variant = 'default', size = 'default', run: _run, set: _set, args: _args, ...rest } = props;
  return <button data-slot="button" data-variant={variant} data-size={size} {...rest} />;
}
