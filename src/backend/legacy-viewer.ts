import { digest, verifyDeployment } from "./deployment.ts";
import type {
  LegacyViewerCompatibility,
  LegacyViewerBindingPort,
} from "./legacy-viewer-contracts.ts";
/** Public generated-code identities only, never an author-controlled allowlist. */
const SOURCES = new Map([
  [
    "d1884699457302bca7dc8d477b4b300a5fb4cfcaaba432899899c76e31f93fa4",
    "953ad6a647c7405c45543074e94c8a25e56b4581f5807729d39dcddb1c600bde",
  ],
  [
    "73a3fe7a517c5c9a43ca537d45a2b938b1290af56f84bd6a29442a3728798934",
    "73221ed99b9f3376c8f24da6c77451bce98bdadb4c6fc53f003abbf35aa70504",
  ],
  [
    "4da0204c7a457956f59c779f7e549842a84570533dba93c36959888e226af7bc",
    "968bcab464469f93ffcbb7e73d0c4536af75a577d7f8b6ed6c180deaf454dd2b",
  ],
  [
    "2e61bc8b2041805f6595aa1ce3f5279348370862e011939f663e385f4582604e",
    "58aedd6bfd60d01736d76152c732e88f2f0b2930b5f7c6d9ef92d00d643cbc04",
  ],
]);
export function createLegacyViewerCompatibility(
  bindings: LegacyViewerBindingPort,
): LegacyViewerCompatibility {
  return {
    async schema(input, signal) {
      const { deployment, typeDefs, backendId, backendVersion, pageId } = input;
      try {
        verifyDeployment(deployment);
      } catch {
        return null;
      }
      if (
        deployment.version !== backendVersion ||
        deployment.typeDefs !== typeDefs ||
        SOURCES.get(digest(deployment.source)) !== digest(typeDefs)
      )
        return null;
      if (
        !(await bindings.current({ backendId, backendVersion, pageId }, signal))
      )
        return null;
      return (
        typeDefs +
        "\ntype DatasetViewer { generation: String! id: String }\nextend type Query { viewer: DatasetViewer! }"
      );
    },
  };
}
