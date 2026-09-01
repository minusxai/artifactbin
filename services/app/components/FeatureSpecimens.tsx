'use client';

/**
 * THE FEATURES BAND — the six claims, each with its illustration, ruled out on
 * a sheet of the art's own paper.
 *
 * THE ONE DECISION THIS COMPONENT MAKES is that the section gets its own
 * MATERIAL. The illustrations are painted on cream paper and that ground is
 * baked into the pixels — so on the app's graphite (or its cool grey light
 * theme) every one of them would land as a cream SQUARE, six stickers on a
 * screen. Painting the band in the paper the art was drawn on turns that inside
 * out: the page carries a sheet, and the objects sit on it.
 *
 * The seam is closed twice, because a flat colour cannot match art that has
 * grain. The band is the MEAN paper of the set; each picture additionally sits
 * on a HALO of its own measured ground (ART_GROUND) which is what fades out
 * into the mount, and the picture's own edge is masked off in the corners where
 * it is bare paper anyway. Fading the picture alone was tried and was not
 * enough: the mismatch that shows is the ground AROUND the object, where the
 * image must stay fully opaque, not the border.
 *
 * THE LAYOUT IS A PRESS SHEET. Cells are ruled apart by a straight hairline
 * lattice with no gaps, and the only rounded thing on it is the plate mounted
 * in each cell — that tension is the idea, not an accident. Each cell is marked
 * at its top-left and bottom-right in its own colour off the art's palette, the
 * way a plate is registered on a sheet; six claims, six colours, none repeated.
 *
 * Dark mode is one rule, in app/globals.css: THE MOUNT STAYS PAPER, EVERYTHING
 * OUTSIDE IT FLIPS. The sheet goes deep navy and the type warm cream, while
 * every picture keeps its paper ground, so the art is never recoloured and
 * never becomes a bright square floating on black. The colours must live in the
 * stylesheet because a component can only write inline styles and an inline
 * style cannot answer [data-theme]; what this file passes in are the two
 * per-variant PAPERS as plain data.
 *
 * Vocabulary follows the material: the type takes the art's own navy rather
 * than the app's foreground and green, which belongs to the terminal chrome.
 *
 * Layouts that were built and cut, so they are not proposed again: pictures
 * alternating down the page (2,500px for six claims, most of it the empty half
 * of each row); a two-across list with the art small beside its text (dense,
 * but 140px turns these illustrations to mush); and the same three-across grid
 * floating on gaps with the whole specimen in a rounded card (fine, but the
 * ruled sheet says more about what the product is).
 */
import { type CSSProperties } from 'react';
import {
  ART_ACCENTS,
  ART_CARD,
  ART_GROUND,
  ART_PAPER,
  REASONS,
  artSrc,
  type ArtVariant,
  type Reason,
} from '@/lib/landing-content';

/** Wider than the page's reading column: the grid is the point of the band. */
const SHEET = 'mx-auto w-full max-w-5xl px-4 sm:px-6';

/**
 * THE TYPE RAMP, expressed against `--ink` rather than a fixed colour: the
 * stylesheet flips that one variable for the sheet in dark mode and holds it
 * dark on anything mounted on paper, so these serve both surfaces.
 */
const INK_BODY = 'color-mix(in srgb, var(--ink) 85%, transparent)';
const INK_QUIET = 'color-mix(in srgb, var(--ink) 64%, transparent)';
const INK_FAINT = 'color-mix(in srgb, var(--ink) 45%, transparent)';

/**
 * The picture's edge, dissolved. Solid well past the object, transparent only
 * out in the corners where every one of these illustrations is bare paper — so
 * nothing drawn is ever dimmed, and the rectangle is gone.
 */
const EDGE_FADE = 'radial-gradient(circle at 50% 50%, #000 76%, transparent 99%)';

/** The picture's own paper, fading into the mount it is laid on. */
const halo = (image: string, variant: ArtVariant) => {
  const ground = ART_GROUND[image]?.[variant] ?? ART_PAPER[variant];
  return `radial-gradient(circle at 50% 50%, ${ground} 0 60%, transparent 93%)`;
};

/**
 * The rounded plate. Its FILL is what the halo fades into — stock a few percent
 * off the sheet, close enough to the art's own ground that the picture has no
 * visible edge inside it. Move the fill far from the paper (white, or the app's
 * surface) and the square this whole treatment removes comes straight back.
 */
const MOUNT = 'specimen-mount overflow-hidden rounded-xl border p-2.5';

/**
 * The registration marks: two opposite corners of each cell. One corner alone
 * reads as decoration; the pair reads as a plate being located. Hairline —
 * at 3px they competed with the illustration, which is backwards for something
 * whose whole job is to sit still.
 */
const MARKS = [
  'top-0 left-0 h-px w-5',
  'top-0 left-0 h-5 w-px',
  'right-0 bottom-0 h-px w-5',
  'right-0 bottom-0 h-5 w-px',
] as const;

/*
 * NO SCROLL REVEAL, deliberately. A fade-and-rise per item was tried and cut:
 * it bought nothing the illustrations do not already do, and it cost real
 * legibility — anything entering at opacity 0 left a band of blank paper for
 * any reader moving faster than the observer (and for every full-page
 * screenshot, which is how it was caught).
 */

export default function FeatureSpecimens({
  variant,
  label,
}: {
  variant: ArtVariant;
  /**
   * Names the rendering on the band itself. Only wanted when both renderings
   * are on the page at once and someone has to tell them apart — the landing
   * shows one and passes nothing.
   */
  label?: string;
}) {
  return (
    <section
      aria-label="Why artifactbin"
      /* The two papers travel as plain data; app/globals.css decides which is
       * used and what flips in dark mode. See `.specimen-band`. */
      style={
        {
          '--paper': ART_PAPER[variant],
          '--card': ART_CARD[variant],
        } as CSSProperties
      }
      className="specimen-band w-full py-12 sm:py-16"
    >
      <div className={SHEET}>
        <div className="flex items-baseline justify-between gap-4">
          <p className="mb-6 flex min-w-0 flex-1 items-center gap-4 font-mono text-xs tracking-[0.18em] text-muted uppercase">
            Why use artifactbin for this?
            <span aria-hidden className="h-px flex-1 bg-[var(--edge)]" />
          </p>
          {label && (
            <span
              className="font-mono text-[10px] tracking-[0.14em] uppercase"
              style={{ color: INK_FAINT }}
            >
              {label}
            </span>
          )}
        </div>
        {/* A statement, so the display face — while the eyebrow above it and
          * every claim title below stay monospace. */}
        <p className="mt-1 font-serif text-[clamp(1.75rem,3.6vw,2.6rem)] leading-[1.12] font-medium tracking-[-0.01em]">
          Everything an artifact should do, out-of-the-box.
        </p>

        {/* The lattice is drawn by giving the list its TOP and LEFT edge and
          * every cell its BOTTOM and RIGHT one, so neighbouring cells share a
          * single hairline and nothing doubles up at a seam. */}
        <ul
          className="mt-8 grid list-none grid-cols-1 gap-0 border-t border-l p-0 sm:mt-10 sm:grid-cols-2 lg:grid-cols-3"
          style={{ borderColor: 'var(--edge)' }}
        >
          {REASONS.map((reason, i) => (
            <li
              key={reason.title}
              className="relative m-0 flex flex-col border-r border-b p-5"
              style={{ borderColor: 'var(--edge)' }}
            >
              {MARKS.map((mark) => (
                <span
                  key={mark}
                  aria-hidden
                  className={`absolute ${mark}`}
                  style={{ background: ART_ACCENTS[i % ART_ACCENTS.length] }}
                />
              ))}

              <Art reason={reason} variant={variant} />

              <div className="mt-3.5">
                <h3 className="font-mono text-[12px] leading-tight font-semibold tracking-[0.14em] uppercase">
                  {reason.title}
                </h3>
                <p
                  className="mt-1.5 font-sans text-[14px] leading-[1.55]"
                  style={{ color: INK_BODY }}
                >
                  {reason.body}
                </p>
              </div>
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}

function Art({ reason, variant }: { reason: Reason; variant: ArtVariant }) {
  return (
    <div className={MOUNT}>
      <div
        className="mx-auto aspect-square w-full max-w-[270px] sm:max-w-none"
        style={{ backgroundImage: halo(reason.image, variant) }}
      >
        <img
          src={artSrc(reason.image, variant, 760)}
          srcSet={`${artSrc(reason.image, variant, 380)} 380w, ${artSrc(reason.image, variant, 760)} 760w`}
          sizes="(min-width: 1024px) 300px, (min-width: 640px) 45vw, 300px"
          alt={reason.alt}
          width={760}
          height={760}
          loading="lazy"
          decoding="async"
          className="block h-full w-full"
          style={{ maskImage: EDGE_FADE, WebkitMaskImage: EDGE_FADE }}
        />
      </div>
    </div>
  );
}
