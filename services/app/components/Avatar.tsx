'use client';

/**
 * A PERSON, DRAWN. Display only: their picture, or — when they have none, or
 * it fails to load — the generated initial on a colour derived from their id.
 *
 * The ONE renderer of a person's face: `AvatarCircle` (the picture as a
 * control, on /welcome and /account) and the app bar's menu button both draw
 * through this, so the two can never show the same person differently.
 *
 * Decorative by contract (`alt=""`, `aria-hidden`): whatever encloses it — a
 * button, a link — carries the name.
 */
import { useState } from 'react';

/**
 * A stable hue per person. Not a hash anybody depends on — it only has to be
 * the same colour every time for the same id, and spread ids around the wheel.
 */
function hueFor(id: string): number {
  let hash = 0;
  for (let i = 0; i < id.length; i++) hash = (hash * 31 + id.charCodeAt(i)) % 360;
  return hash;
}

export default function Avatar({ image, initial, userId, size }: {
  /** The picture's address, or null for the generated initial. */
  image: string | null;
  /** The text whose first letter is drawn when there is no picture. */
  initial: string;
  /** Whose picture: the colour behind the initial comes from this. */
  userId: string;
  /** Diameter in px; omitted, it fills its container (which sets the shape). */
  size?: number;
}) {
  // The address that failed, not a flag: a NEW address gets its own chance.
  const [failed, setFailed] = useState<string | null>(null);
  const style = size ? { width: size, height: size } : { width: '100%', height: '100%' };
  if (image && failed !== image) {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img src={image} alt="" aria-hidden="true" style={style} onError={() => setFailed(image)} className="block shrink-0 rounded-full object-cover" />
    );
  }
  return (
    <span
      aria-hidden="true"
      style={{ ...style, backgroundColor: `hsl(${hueFor(userId)} 55% 32%)`, ...(size ? { fontSize: Math.round(size * 0.42) } : {}) }}
      className={`${size ? '' : 'text-3xl '}flex shrink-0 items-center justify-center rounded-full font-semibold leading-none text-white`}
    >
      {(initial.trim()[0] ?? '?').toUpperCase()}
    </span>
  );
}
