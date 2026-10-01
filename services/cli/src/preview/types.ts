/** The `/document` JSON shape — shared by the client bundle and the local `ArtifactBackend` adapter. */
import type {StoryIslandData} from '../../../app/lib/story-runtime/contract';
import type {PreparedStoryRuntime} from '../../../app/lib/story/prepared/prepared-runtime';
import type {DocumentMetadata} from '../document';

export interface PreviewDocument {
 body: string;
 revision: string;
 data: StoryIslandData;
 metadata: DocumentMetadata;
 prepared?: PreparedStoryRuntime;
}
