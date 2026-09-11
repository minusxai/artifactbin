"""Planning-only, tools-disabled command-selection smoke; not an end-to-end eval."""
import json
import os
import pathlib
import subprocess
import tempfile
import concurrent.futures
import argparse
import re
import time

PROMPT = '''This is a command-selection study for a proposed CLI, not an implementation task.
Do not use tools. Return a numbered list of exact commands or missing contract details.
Available help:
afbin pull [ref] [path]: download head or ref@version; refuses dirty files unless --force.
afbin push [path ...]: publish changed tracked files; explicit paths add new files.
afbin validate [path ...]: offline/read-only; --fix applies mechanical repairs.
afbin status: offline, against last observed state; --remote checks fresh server state.
afbin diff [ref]: local diff against saved state; --remote compares current head.
afbin log ref: list versions.
afbin comment ref: list threads; --body/--body-file posts; --reply selects thread; --resolve resolves.
afbin setup: browser pairing and skill checklist; --harness repeatable, none skips skills.
afbin update: update binary and remembered selected skills.
--yes accepts CLI confirmations, not browser approval or conflict overwrite. --json emits one result.
Existing local paths win over parsing a trailing @version. Historical pull followed by push restores.
Tasks (independent):
1. Inspect local changes offline, without authentication.
2. Check whether the server changed since last pull.
3. Repair and publish report.jsx.
4. Restore report.jsx to version 2 without inventing a new verb.
5. Update unattended using remembered harness selections.
6. Set up only pi and opencode, accepting CLI defaults.
7. Reply "Fixed" to thread ann_123 on report.jsx and resolve it.
8. A stale push conflicts with another writer; preserve their work. What do you do?
Also identify ambiguous rules in this help. Never claim you executed commands.
'''

CLARIFICATIONS = '''
Additional help text:
<ref> means an artifact id, URL or tracked local path, optionally ending @<integer version>.
For example: pull report.jsx@2 selects version 2 of report.jsx; pull k7f2q9@2 report.jsx
uses an explicit artifact id and destination if a local filename shadows the version syntax.
Historical pull marks the file pending; push publishes it as a new head.
status reports a summary; diff shows line-by-line content changes. --remote opts into fresh state.
validate accepts explicit new or tracked files. --fix formats and repairs known syntax/retired names;
it is idempotent and does not publish. push explicitly named new files creates; tracked files update.
setup --harness <name> selects an integration to install/update; repeat to select an exact set.
Example: setup --harness pi --harness opencode --yes. Saved choices are used by update.
update --yes requires no browser approval; first sign-in via setup still requires browser approval.
comment <artifact-ref> --reply <thread-id> --body <text> --resolve replies and resolves that thread.
--resolve is boolean and requires --reply; it does not take the thread id itself.
All commands support --json: one JSON result on stdout, diagnostic prose only on stderr.
doc_changed recovery: preserve the dirty file in an unused local backup path, then pull --force
the same tracked file to get fresh canonical content and sync metadata. Manually reapply/merge
the saved local changes into that file while preserving the new sync fields; validate and push.
Never recommend push --force when the objective is to preserve another writer's work.
'''

def run(harness, key=None, model='accounts/fireworks/models/deepseek-v4-flash-0731'):
    with tempfile.TemporaryDirectory(prefix='afbin-familiarity-') as cwd:
        env = os.environ.copy()
        if key:
            env['FIREWORKS_API_KEY'] = key
        env['PI_CODING_AGENT_DIR'] = str(pathlib.Path(cwd) / 'pi-state')
        for item in ['CONFIG', 'DATA', 'CACHE', 'STATE']:
            env['XDG_' + item + '_HOME'] = str(pathlib.Path(cwd) / item.lower())
        env['OPENCODE_CONFIG_DIR'] = str(pathlib.Path(cwd) / 'opencode-config')
        if harness == 'pi':
            agent_dir = pathlib.Path(env['PI_CODING_AGENT_DIR'])
            agent_dir.mkdir()
            (agent_dir / 'models.json').write_text(json.dumps({'providers': {'fw-probe': {
                'baseUrl': 'https://api.fireworks.ai/inference/v1',
                'api': 'openai-completions', 'apiKey': '$FIREWORKS_API_KEY',
                'models': [{'id': model, 'name': 'CLI planning probe', 'reasoning': False,
                            'contextWindow': 65536, 'maxTokens': 4096}]
            }}}))
            argv = ['pi', '--print', '--mode', 'json', '--no-tools', '--no-extensions',
                    '--no-skills', '--no-context-files', '--no-prompt-templates',
                    '--no-session', '--offline', '--provider', 'fw-probe', '--model', model,
                    '--thinking', 'minimal', PROMPT]
        else:
            env['OPENCODE_CONFIG_CONTENT'] = json.dumps({
                'permission': {'*': 'deny'}, 'share': 'disabled',
                'provider': {'fireworks': {
                    'npm': '@ai-sdk/openai-compatible', 'name': 'Fireworks',
                    'options': {'baseURL': 'https://api.fireworks.ai/inference/v1',
                                'apiKey': '{env:FIREWORKS_API_KEY}'},
                    'models': {model: {'name': 'CLI planning probe', 'limit': {'context': 65536, 'output': 4096}}}
                }}
            })
            argv = ['opencode', 'run', '--pure', '--model', 'fireworks/' + model, '--format', 'json', PROMPT]
        started = time.monotonic()
        try:
            p = subprocess.run(argv, cwd=cwd, env=env, stdin=subprocess.DEVNULL,
                               capture_output=True, text=True, timeout=180)
            result = {'harness': harness, 'model': model, 'exit': p.returncode,
                      'seconds': round(time.monotonic() - started, 2),
                      'stdout': p.stdout.replace(key, '[REDACTED]') if key else p.stdout,
                      'stderr': p.stderr.replace(key, '[REDACTED]') if key else p.stderr}
        except subprocess.TimeoutExpired:
            result = {'harness': harness, 'error': 'timeout after 180 seconds; no completion claimed'}
        return result

if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('--env-file', required=True)
    parser.add_argument('--revised', action='store_true')
    args = parser.parse_args()
    if args.revised:
        PROMPT = PROMPT.replace('Tasks (independent):', CLARIFICATIONS + '\nTasks (independent):')
    key = None
    for line in pathlib.Path(args.env_file).read_text().splitlines():
        match = re.match(r'^\s*(?:export\s+)?FIREWORKS_API_KEY\s*=\s*(.*?)\s*$', line)
        if match:
            key = match[1].strip().strip('"\'')
    if not key:
        raise SystemExit('FIREWORKS_API_KEY missing from the selected file')
    destination = pathlib.Path(tempfile.mkdtemp(prefix='afbin-familiarity-results-'))
    with concurrent.futures.ThreadPoolExecutor(max_workers=2) as pool:
        for result in pool.map(lambda harness: run(harness, key), ['pi', 'opencode']):
            path = destination / (result['harness'] + '.json')
            path.write_text(json.dumps(result, indent=2))
            print(json.dumps({'harness': result['harness'], 'exit': result.get('exit'),
                              'error': result.get('error'), 'transcript': str(path)}), flush=True)
