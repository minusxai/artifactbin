'use client';

/**
 * A PERSON, DRAWN. Display only: the generated initial on the colour their id
 * decides, and — when they have one — their picture painted OVER it.
 *
 * The ONE app-side React face: `AvatarCircle` (the picture as a control, on
 * /welcome and /account), the app bar's menu button and the profile header all
 * draw through this. The colour and the letter come from `lib/person-face`, the
 * same module the document kit and the reader rail draw from, so a person is
 * one colour and one letter everywhere.
 *
 * The initial is ALWAYS underneath. A picture is an address and an address can
 * fail; one that does is taken away, revealing the initial, and never leaves a
 * browser's broken-image glyph behind.
 *
 * Decorative by contract (`alt=""`, `aria-hidden`): whatever encloses it — a
 * button, a link, a heading — carries the name.
 */
import { useState } from 'react';
import { personFaceBackground, personInitial } from '@/lib/person-face';

export default function Avatar({ image, initial, userId, size }: {
  /** The picture's address, or null for the generated initial. */
  image: string | null;
  /** The name whose first letter is drawn underneath the picture. */
  initial: string;
  /** Whose face: the colour behind the initial comes from this. */
  userId: string;
  /** Diameter in px; omitted, it fills its container (which sets the shape). */
  size?: number;
}) {
  // The address that failed, not a flag: a NEW address gets its own chance.
  const [failed, setFailed] = useState<string | null>(null);
  const box = size ? { width: size, height: size } : { width: '100%', height: '100%' };
  return (
    <span aria-hidden="true" style={box} className="relative block shrink-0 overflow-hidden rounded-full">
      <span
        data-face-initial=""
        style={{ backgroundColor: personFaceBackground(userId), ...(size ? { fontSize: Math.round(size * 0.42) } : {}) }}
        className={`${size ? '' : 'text-3xl '}flex size-full items-center justify-center font-semibold leading-none text-white`}
      >
        {personInitial(initial)}
      </span>
      {image && failed !== image && (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={image} alt="" onError={() => setFailed(image)} className="absolute inset-0 size-full object-cover" />
      )}
    </span>
  );
}
