'use client';

/**
 * THE RENDERER for `lib/markdown-lite` — React elements, and only ever React
 * elements. There is no `dangerouslySetInnerHTML` here and there must never
 * be one: the parser refuses raw HTML, so the text an AGENT wrote reaches the
 * app's own origin as characters, and this file is what keeps that true.
 *
 * The typography is the point of the whole feature. The app's body face is
 * MONO (`app/globals.css`), so a comment used to arrive as one undifferentiated
 * block whatever it said — a reply naming files, functions and a regex read
 * exactly like the prose around it. Here prose takes the SANS face and mono is
 * spent on the two things that earn it: inline code and a fenced block.
 *
 * A `<pre>` is the one child that can be wider than the rail it sits in, so it
 * scrolls INSIDE its own box (`overflow-x-auto`, `min-w-0` above it) rather
 * than pushing the panel past `RIGHT_RAIL_W`.
 */
import { Fragment, type ReactNode } from 'react';
import { parseMarkdownLite, type MdInline, type MdNode } from '@/lib/markdown-lite';

/*
 * `break-all` is not cosmetic. A <pre> scrolls inside itself, but INLINE code
 * has no box of its own to scroll — a 200-character identifier inside a list
 * item or a blockquote simply ran off the rail's edge with nothing to say so.
 * The rail's width is fixed either way; this decides whether the name is
 * readable or cut.
 */
const CODE_CLASS = 'break-all rounded-[3px] bg-raised px-1 py-0.5 font-mono text-[0.92em] text-fg';

function renderInline(nodes: MdInline[]): ReactNode[] {
  return nodes.map((node, i) => {
    switch (node.kind) {
      // A Fragment, not a span: a wrapper element around plain text would make
      // every emphasised word match a text query twice over.
      case 'text':
        return <Fragment key={i}>{node.text}</Fragment>;
      case 'break':
        return <br key={i} />;
      case 'strong':
        return <strong key={i} className="font-semibold text-fg">{renderInline(node.children)}</strong>;
      case 'em':
        return <em key={i} className="italic">{renderInline(node.children)}</em>;
      case 'code':
        return <code key={i} className={CODE_CLASS}>{node.text}</code>;
      case 'link':
        if (/^\/chat\?session=[a-f0-9-]{36}$/.test(node.href)) return (
          <a key={i} href={node.href} target="_blank" rel="noopener noreferrer"
            title="Open agent session" data-agent-mention
            className="inline-flex max-w-full items-center rounded-md border border-accent/20 bg-accent-soft px-1.5 py-0.5 align-baseline text-[0.9em] font-medium text-accent no-underline hover:bg-accent/15 focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent">
            {renderInline(node.children)}
          </a>
        );
        // A new tab, and never a handle on this window: the body is text
        // somebody else wrote, so `noopener` is not optional here.
        return (
          <a
            key={i}
            href={node.href}
            target="_blank"
            rel="noopener noreferrer"
            className="break-words text-accent underline decoration-dotted underline-offset-2 hover:decoration-solid"
          >
            {renderInline(node.children)}
          </a>
        );
    }
  });
}

function renderBlock(node: MdNode, key: number): ReactNode {
  switch (node.kind) {
    case 'paragraph':
      return <p key={key} className="leading-normal">{renderInline(node.children)}</p>;
    case 'code_block':
      return (
        <pre
          key={key}
          className="min-w-0 max-w-full overflow-x-auto rounded-[4px] border border-edge bg-raised p-2 font-mono text-[11px] leading-snug text-fg"
        >
          <code>{node.text}</code>
        </pre>
      );
    case 'list': {
      const Tag = node.ordered ? 'ol' : 'ul';
      return (
        <Tag key={key} className={`min-w-0 pl-5 ${node.ordered ? 'list-decimal' : 'list-disc'} marker:text-faint`}>
          {node.items.map((item, i) => (
            <li key={i} className="min-w-0 leading-normal">{item.children.map((child, j) => renderBlock(child, j))}</li>
          ))}
        </Tag>
      );
    }
    case 'quote':
      return (
        <blockquote key={key} className="min-w-0 border-l-2 border-edge pl-2.5 text-muted">
          {node.children.map((child, i) => renderBlock(child, i))}
        </blockquote>
      );
  }
}

/** The parsed body as elements — exported for anything holding nodes already. */
export function renderMarkdownLite(nodes: MdNode[]): ReactNode {
  return nodes.map((node, i) => renderBlock(node, i));
}

/**
 * One comment body, read. `label` makes the rendering findable when it stands
 * in for a field (the composer's preview); the reading surfaces need none.
 */
export default function MarkdownLite({ text, label, className = '' }: {
  text: string;
  label?: string;
  className?: string;
}) {
  return (
    <div
      data-markdown
      aria-label={label}
      className={`flex min-w-0 flex-col gap-2 font-sans leading-normal text-fg/90 ${className}`}
    >
      {renderMarkdownLite(parseMarkdownLite(text))}
    </div>
  );
}
