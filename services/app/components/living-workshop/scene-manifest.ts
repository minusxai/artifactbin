import { SHOWCASE, showcaseCardUrl, showcaseHref } from "@/lib/showcase";
import type { PaperSlot } from "./paper-model";

export interface WorkshopPaper extends PaperSlot {
  title: string;
  kind: string;
  href: string;
  image: string;
}
// Placement belongs to the scene; titles, destinations and captures remain catalog-owned.
const PLACEMENTS = [
  {
    id: "YPLu0U",
    x: 730,
    y: 100,
    width: 145,
    height: 155,
    angle: -0.085,
  },
  {
    id: "OewuPR",
    x: 888,
    y: 72,
    width: 282,
    height: 176,
    angle: 0.065,
  },
  {
    id: "iTlSrH",
    x: 1157,
    y: 90,
    width: 167,
    height: 175,
    angle: -0.09,
  },
  {
    id: "Pej96A",
    x: 720,
    y: 270,
    width: 163,
    height: 133,
    angle: 0.075,
  },
  {
    id: "yKcybb",
    x: 915,
    y: 276,
    width: 205,
    height: 175,
    angle: -0.06,
  },
  {
    id: "wxeC8G",
    x: 1138,
    y: 283,
    width: 210.6,
    height: 149.4,
    angle: 0.1,
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
export const WORKSHOP_IMAGE = "/landing/workshop/indoor-1672.webp";

export interface WorkshopSetting {
  liveRobots?: boolean;
  fallbackImage?: string;
  image: string;
  mask: string;
  name: "indoor" | "outdoor";
}
export const WORKSHOP_SETTINGS: Record<
  WorkshopSetting["name"],
  WorkshopSetting
> = {
  indoor: {
    image: "/landing/workshop/indoor-1672.webp",
    fallbackImage: WORKSHOP_IMAGE,
    liveRobots: true,
    mask: "/landing/workshop/foreground-mask-gray.png",
    name: "indoor",
  },
  outdoor: {
    image: "/landing/workshop/outdoor-1672.webp",
    liveRobots: true,
    mask: "/landing/workshop/foreground-mask-gray.png",
    name: "outdoor",
  },
};

// Shared delivery sizes for HTML fallback and WebGL. Originals remain authoring assets.
export const WORKSHOP_IMAGE_WIDTHS = [960, 1672, 2560, 3344] as const;
export function workshopImageAt(name: WorkshopSetting["name"], width: number) {
  return `/landing/workshop/${name}-${width}.webp`;
}
export function workshopImageSrcSet(name: WorkshopSetting["name"]) {
  return WORKSHOP_IMAGE_WIDTHS.map(
    (width) => `${workshopImageAt(name, width)} ${width}w`,
  ).join(", ");
}
