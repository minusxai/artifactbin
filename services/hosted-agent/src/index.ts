/** The hosted-agent runtime: what a compute job imports to run one managed harness and save its connection. */
export {runRemote,type RunOptions} from './runner.js';
export {HttpClient} from './http.js';
export {loadConnection,saveConnection,normalizeServer,type Connection} from './config.js';
export {runHostedAgent} from './hosted-agent.js';
export {installAuthorSkill,authorSkillTargets,readSkillZip} from './author-skill.js';

import {fileURLToPath} from 'node:url';
import {SKILL_COMMAND_ARG,runSkillCommand} from './skill-command.js';
// Executed as a program (the bundle a hosted agent's `<state>/artifactbin` runs), not imported.
if(process.argv[1]&&process.argv[1]===fileURLToPath(import.meta.url)&&process.argv[2]===SKILL_COMMAND_ARG)process.exitCode=await runSkillCommand(process.argv.slice(3));
