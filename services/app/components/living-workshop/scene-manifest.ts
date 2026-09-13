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
    x: 666,
    y: 99,
    width: 184,
    height: 208,
    angle: -0.085,
    reveal: "Edit it with your own hands.",
  },
  {
    id: "5fN6kY",
    x: 885,
    y: 88,
    width: 235,
    height: 211,
    angle: 0.065,
    reveal: "Leave feedback where it belongs.",
  },
  {
    id: "OewuPR",
    x: 1143,
    y: 112,
    width: 172,
    height: 220,
    angle: -0.09,
    reveal: "Explore the data behind the page.",
  },
  {
    id: "wxeC8G",
    x: 652,
    y: 326,
    width: 191,
    height: 201,
    angle: 0.075,
    reveal: "Make work worth sharing.",
  },
  {
    id: "yKcybb",
    x: 913,
    y: 319,
    width: 218,
    height: 215,
    angle: -0.06,
    reveal: "Bring your favorite agent.",
  },
  {
    id: "EN6QaQ",
    x: 1159,
    y: 361,
    width: 164,
    height: 174,
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
export const WORKSHOP_IMAGE = "/landing/workshop/indoor-polished.webp";

export interface WorkshopSetting {
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
    mask: "/landing/workshop/indoor-mask.png",
    name: "indoor",
  },
  outdoor: {
    image: "/landing/workshop/outdoor-polished.webp",
    mask: "/landing/workshop/outdoor-mask.png",
    name: "outdoor",
  },
};
