/**
 * A policy, rendered. Long-form legal text is the one place on this product
 * where the reading column is NARROWER than the app's, and the face is sans
 * rather than mono: nobody reads sixty lines of monospace, and a policy people
 * bounce off is a policy that did not disclose anything.
 *
 * The document itself is data (lib/legal), so both policies get the same
 * treatment and neither can drift into its own styling.
 */
import { LEGAL, type LegalSlug } from '@/lib/legal';
import { LINK } from '@/components/ui';

export default function LegalDocument({ slug }: { slug: LegalSlug }) {
  const doc = LEGAL[slug];
  const other = slug === 'privacy' ? LEGAL.terms : LEGAL.privacy;

  return (
    <main aria-label={doc.title} className="mx-auto max-w-2xl px-4 pt-12 pb-24 sm:px-6">
      <p className="font-mono text-[10px] tracking-[0.14em] text-faint uppercase">
        artifact-bin · hosted service
      </p>
      <h1 className="mt-3 font-mono text-2xl font-bold tracking-[-0.03em] text-fg sm:text-3xl">
        {doc.title}
      </h1>
      <p className="mt-2 font-mono text-[11px] text-faint">Last updated {doc.updated}</p>
      <p className="mt-6 border-l-2 border-accent pl-4 font-sans text-[15px] leading-relaxed text-fg">
        {doc.lede}
      </p>

      {doc.sections.map((section) => (
        <section key={section.heading} className="mt-10">
          <h2 className="font-mono text-[13px] tracking-[0.02em] text-fg">{section.heading}</h2>
          {section.body?.map((paragraph) => (
            <p key={paragraph} className="mt-3 font-sans text-[14px] leading-relaxed text-muted">
              {paragraph}
            </p>
          ))}
          {section.bullets && (
            <ul className="mt-3 space-y-2">
              {section.bullets.map((item) => (
                <li
                  key={item}
                  className="grid grid-cols-[0.75rem_minmax(0,1fr)] gap-2 font-sans text-[14px] leading-relaxed text-muted"
                >
                  <span aria-hidden className="pt-[0.45em] font-mono text-faint">
                    ·
                  </span>
                  <span>{item}</span>
                </li>
              ))}
            </ul>
          )}
        </section>
      ))}

      <nav
        aria-label="Other policies"
        className="mt-14 flex flex-wrap items-center gap-x-5 gap-y-2 border-t border-edge pt-5 font-mono text-[11px] text-muted"
      >
        <a href={`/${other.slug}`} className={LINK}>
          {other.title.toLowerCase()}
        </a>
        <a href="https://minusx.ai" target="_blank" rel="noreferrer" className={LINK}>
          minusx
        </a>
        <a href="/" className={LINK}>
          back to artifact-bin
        </a>
      </nav>
    </main>
  );
}
