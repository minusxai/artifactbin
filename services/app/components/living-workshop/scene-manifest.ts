import { SHOWCASE, showcaseCardUrl, showcaseHref } from "@/lib/showcase";
import type { PaperSlot } from "./paper-model";

export interface WorkshopPaper extends PaperSlot {
  title: string;
  kind: string;
  href: string;
  image: string;
  reveal: string;
}
// Placement belongs to the scene; titles, destinations and captures remain catalog-owned.
const PLACEMENTS = [
  {
    id: "YPLu0U",
    x: 730,
    y: 80,
    width: 145,
    height: 175,
    angle: -0.085,
    reveal: "Edit it with your own hands.",
  },
  {
    id: "5fN6kY",
    x: 907,
    y: 72,
    width: 220,
    height: 176,
    angle: 0.065,
    reveal: "Leave feedback where it belongs.",
  },
  {
    id: "OewuPR",
    x: 1157,
    y: 90,
    width: 167,
    height: 175,
    angle: -0.09,
    reveal: "Explore the data behind the page.",
  },
  {
    id: "wxeC8G",
    x: 720,
    y: 270,
    width: 163,
    height: 173,
    angle: 0.075,
    reveal: "Make work worth sharing.",
  },
  {
    id: "yKcybb",
    x: 930,
    y: 276,
    width: 205,
    height: 175,
    angle: -0.06,
    reveal: "Bring your favorite agent.",
  },
  {
    id: "EN6QaQ",
    x: 1168,
    y: 283,
    width: 162,
    height: 166,
    angle: 0.1,
    reveal: "Your work. Your own little corner.",
  },
];
export const WORKSHOP_PAPERS: WorkshopPaper[] = PLACEMENTS.flatMap((slot) => {
  const doc = SHOWCASE.find((item) => item.id === slot.id);
  return doc
    ? [
        {
          ...slot,
          title: doc.title,
          kind: doc.kind,
          href: showcaseHref(doc),
          image: showcaseCardUrl(doc),
        },
      ]
    : [];
});
export const WORKSHOP_IMAGE = "/landing/workshop/indoor-wide_3.webp";

export interface WorkshopSetting {
  /** Optional six-cell, 3 × 2 artwork atlas for the visual review routes. */
  posterAtlas?: string;
  image: string;
  mask: string;
  name: "indoor" | "outdoor";
}
export const WORKSHOP_SETTINGS: Record<
  WorkshopSetting["name"],
  WorkshopSetting
> = {
  indoor: {
    image: WORKSHOP_IMAGE,
    mask: "/landing/workshop/wide-girl-mask.svg",
    name: "indoor",
  },
  outdoor: {
    image: "/landing/workshop/outdoor-wide_3.webp",
    mask: "/landing/workshop/wide-girl-mask.svg",
    name: "outdoor",
  },
};
