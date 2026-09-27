/** The `avatar` kit chunk (lib/story-ui/kit-chunks): loaded for the documents that draw `<Avatar>`, `<AvatarImage>`, `<AvatarFallback>`, and the rest of its family. */
import { Avatar, AvatarImage, AvatarFallback, AvatarBadge, AvatarGroup, AvatarGroupCount } from '@/components/kit/avatar';
import type { KitChunk } from '../kit-registry';

export const chunk: KitChunk = { faces: { Avatar, AvatarImage, AvatarFallback, AvatarBadge, AvatarGroup, AvatarGroupCount } };
