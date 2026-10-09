/** The `/document` JSON shape — shared by the client bundle and the local `ArtifactBackend` adapter. */
import type {StoryIslandData,PreparedStoryRuntime} from '../../../app/lib/cli-toolkit/host.server';
import type {DocumentMetadata} from '../document';

export interface PreviewDocument {
 body: string;
 revision: string;
 data: StoryIslandData;
 metadata: DocumentMetadata;
 prepared?: PreparedStoryRuntime;
}
