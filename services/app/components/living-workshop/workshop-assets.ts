/** Shared request identities let HTML preloads and scene loaders reuse the same bytes. */
const ROOT = "/landing/workshop/robots/";
export const workshopRobotUrl = (role: string) => `${ROOT}workshop-bot-${role}.glb?pose=close-inspection-2`;
export const workshopBadgeUrl = (agent: string) => `${ROOT}badge-${agent}.png`;
export const WORKSHOP_ARM_URL = `${ROOT}workshop-arm.glb`;
export function workshopPosterUrl(image: string, development: boolean) {
  const preview = new URL(image);
  return development ? `/__dev/showcase${preview.pathname}${preview.search}` : image;
}
export const WORKSHOP_ROBOTS = [
    {
      x: 910,
      y: 727,
      size: 57,
      turn: 0.824,
      agent: "opencode",
      role: "inspector",
      offset: 1.3,
    },
    {
      x: 675,
      y: 483,
      size: 60,
      turn: 0.42,
      agent: "claude",
      role: "standing",
      offset: 0,
    },
    {
      x: 565,
      y: 664,
      size: 64,
      turn: 0.34,
      agent: "codex",
      role: "pencil",
      offset: 2.2,
    },
    {
      x: 1036,
      y: 705,
      size: 56,
      turn: 0.4,
      agent: "pi",
      role: "paper",
      offset: 4.1,
    },
  ];
