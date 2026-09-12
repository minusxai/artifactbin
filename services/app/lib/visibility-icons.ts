import type { IconNode } from 'lucide-react';
import type { Visibility } from '@/lib/artifacts';

export interface SharingVerdict {
  visibility: Visibility;
  hasInvitedUsers: boolean;
}
export type SharingIcon = Visibility | 'shared';

/** Named grants change a private link's verdict, not its visibility setting. */
export function sharingIconFor({ visibility, hasInvitedUsers }: SharingVerdict): SharingIcon {
  return visibility === 'private' && hasInvitedUsers ? 'shared' : visibility;
}

/** Lucide 1.30 geometry shared by React sharing controls and string-rendered chrome. */
export const VISIBILITY_ICON_NODES: Record<SharingIcon, IconNode> = {
  shared: [
    ['path', { d: 'M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2', key: 'users-body' }],
    ['path', { d: 'M16 3.128a4 4 0 0 1 0 7.744', key: 'users-back-head' }],
    ['path', { d: 'M22 21v-2a4 4 0 0 0-3-3.87', key: 'users-back-body' }],
    ['circle', { cx: '9', cy: '7', r: '4', key: 'users-head' }],
  ],
  private: [
    ['rect', { width: '18', height: '11', x: '3', y: '11', rx: '2', ry: '2', key: 'lock-body' }],
    ['path', { d: 'M7 11V7a5 5 0 0 1 10 0v4', key: 'lock-shackle' }],
  ],
  unlisted: [
    ['path', { d: 'M10.733 5.076a10.744 10.744 0 0 1 11.205 6.575 1 1 0 0 1 0 .696 10.747 10.747 0 0 1-1.444 2.49', key: 'eye-top' }],
    ['path', { d: 'M14.084 14.158a3 3 0 0 1-4.242-4.242', key: 'eye-pupil' }],
    ['path', { d: 'M17.479 17.499a10.75 10.75 0 0 1-15.417-5.151 1 1 0 0 1 0-.696 10.75 10.75 0 0 1 4.446-5.143', key: 'eye-bottom' }],
    ['path', { d: 'm2 2 20 20', key: 'eye-slash' }],
  ],
  public: [
    ['circle', { cx: '12', cy: '12', r: '10', key: 'globe-outline' }],
    ['path', { d: 'M12 2a14.5 14.5 0 0 0 0 20 14.5 14.5 0 0 0 0-20', key: 'globe-meridian' }],
    ['path', { d: 'M2 12h20', key: 'globe-equator' }],
  ],
};

/** Only the fixed, trusted geometry above is serialized; no authored attributes enter here. */
export function visibilityIconPaths(visibility: SharingIcon): string {
  return VISIBILITY_ICON_NODES[visibility].map(([tag, attributes]) =>
    `<${tag} ${Object.entries(attributes).filter(([name]) => name !== 'key').map(([name, value]) => `${name}="${value}"`).join(' ')}/>`
  ).join('');
}
