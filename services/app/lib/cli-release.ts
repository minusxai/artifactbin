/** Release metadata is bundled at build time; onboarding never polls a release server. */
import cliPackage from '../../cli/package.json';
export const CLI_VERSION = cliPackage.version;
export const CLI_SKILLS_DOWNLOAD = `https://github.com/minusxai/artifactbin/releases/download/afbin-v${CLI_VERSION}/afbin-skills.tar.gz`;
