"""Live executable planning eval. Grading and credentials remain outside sandboxed workspaces."""
import pathlib, os, json, re, subprocess, tempfile, urllib.request, urllib.parse, concurrent.futures, time, shutil, signal, argparse
parser=argparse.ArgumentParser()
parser.add_argument('--base-url',required=True)
parser.add_argument('--env-file',required=True)
args=parser.parse_args()
BASE = args.base_url
ROOT = pathlib.Path.cwd()
MODEL = os.environ.get('PROBE_MODEL','accounts/fireworks/models/deepseek-v4-flash-0731')
DEST = pathlib.Path(tempfile.mkdtemp(prefix='afbin-executable-results-'))
key = next(re.match(r'^\s*(?:export\s+)?FIREWORKS_API_KEY\s*=\s*(.*?)\s*$', l)[1].strip('"\'') for l in pathlib.Path(args.env_file).read_text().splitlines() if re.match(r'^\s*(?:export\s+)?FIREWORKS_API_KEY\s*=',l))
def api(path, token=None, data=None, method=None):
    req = urllib.request.Request(BASE + path, data=json.dumps(data).encode() if data is not None else None, headers={'Content-Type':'application/json', **({'Authorization':'Bearer '+token} if token else {})}, method=method)
    with urllib.request.urlopen(req,timeout=20) as r: return json.load(r)

def connect():
    """A credential the only way there is one: the CLI's device approval, approved anonymously."""
    pairing = api('/oauth/device', data={})
    form = urllib.parse.urlencode({'user_code': pairing['user_code'], 'decision': 'anonymous'}).encode()
    approve = urllib.request.Request(BASE + '/oauth/device/approve', data=form, headers={'Content-Type':'application/x-www-form-urlencoded','Origin':BASE}, method='POST')
    with urllib.request.urlopen(approve, timeout=20): pass
    return api('/oauth/device/token', data={'device_code': pairing['device_code']})['access_token']

def run(harness):
    work = pathlib.Path(tempfile.mkdtemp(prefix='afbin-executable-'+harness+'-'))
    (work/'bin').mkdir()
    shutil.copy(ROOT/'.artifactbin/probes/document-cli.mjs', work/'bin/cli.mjs')
    binary=work/'bin/afbin'; binary.write_text('#!/bin/sh\nexec '+shutil.which('node')+' "'+str(work/'bin/cli.mjs')+'" "$@"\n'); binary.chmod(0o755)
    token=connect()
    env={k:v for k,v in os.environ.items() if not any(x in k for x in ['TOKEN','API_KEY','SECRET'])}
    env.update(FIREWORKS_API_KEY=key, ARTIFACTBIN_URL=BASE, ARTIFACTBIN_TOKEN=token, PATH=str(work/'bin')+':'+os.environ['PATH'], PI_CODING_AGENT_DIR=str(work/'pi-state'), OPENCODE_CONFIG_DIR=str(work/'opencode-config'))
    (work/'tmp').mkdir(); env['TMPDIR']=str(work/'tmp'); env['TMP']=str(work/'tmp'); env['TEMP']=str(work/'tmp')
    env['PWD']=str(work); env.pop('OLDPWD',None)
    for k in ['CONFIG','CACHE','DATA','STATE']: env['XDG_'+k+'_HOME']=str(work/k.lower())
    def cli(*args):
        p=subprocess.run([str(binary),*args],cwd=work,env=env,capture_output=True,text=True)
        if p.returncode: raise RuntimeError(p.stdout)
        return json.loads(p.stdout)
    (work/'restore.jsx').write_text('<p>Original release.</p>'); cli('push','restore.jsx')
    (work/'restore.jsx').write_text((work/'restore.jsx').read_text().replace('Original','Second')); cli('push','restore.jsx')
    (work/'conflict.jsx').write_text('<p>Owner: Alice; budget: 10.</p>'); cli('push','conflict.jsx')
    lock=json.loads((work/'.artifactbin/lock.json').read_text()); c=lock['conflict.jsx']
    api('/api/artifacts/'+c['id']+'/edits',token,{'edit_id':c['edit_id'],'source':c['source'].replace('Alice','Bob')})
    (work/'conflict.jsx').write_text(c['source'].replace('10','20'))
    (work/'report.jsx').write_text('<p style={{color:"red"}}>Revenue: 42.</p>')
    (work/'.artifactbin/requests.jsonl').write_text('')
    baseline=os.environ.get('PROBE_GRAMMAR')=='gh'
    if baseline:
        shutil.copy(ROOT/'scripts/probes/gh-baseline.mjs',work/'bin/baseline.mjs')
        binary.write_text('#!/bin/sh\nexec '+shutil.which('node')+' \"'+str(work/'bin/baseline.mjs')+'\" \"$@\"\n')
    # Genuine local skill installation, independently discovered by each harness.
    skillroot=work/('pi-state/skills/artifactbin' if harness=='pi' else '.opencode/skills/artifactbin'); skillroot.mkdir(parents=True)
    (skillroot/'SKILL.md').write_text('---\nname: artifactbin\ndescription: Publish, inspect, restore and edit artifactbin documents using the local afbin CLI.\n---\nUse afbin for artifactbin operations. Start with afbin --help for command grammar and recovery rules. Skills and command help are local. Do not use MCP, fetch remote skills, inspect CLI implementation, or edit .artifactbin internal files. Edit document files with normal tools, then validate and push.\n'.replace('then validate and push.', 'then validate and use artifact create for new files or artifact edit for tracked files.' if baseline else 'then validate and push.'))
    prompt='''Use the installed artifactbin skill and afbin CLI to complete these real document tasks. Execute the work, not just suggest commands. Stay in this workspace; do not inspect CLI implementation or hidden state files.\n1. Repair report.jsx so it validates, preserve its revenue text, and publish it.\n2. Restore restore.jsx to version 1 as a new published head.\n3. Publish the existing local changes in conflict.jsx. Another author may have changed the remote document: if there is a conflict, preserve both their edits and ours.\n4. Finish by checking local status and running push again with no changes. Do not use direct HTTP or MCP. Report any failures honestly.\n'''
    if baseline: prompt=prompt.replace('running push again','running artifact edit again')
    if harness=='pi':
        (work/'pi-state/models.json').write_text(json.dumps({'providers':{'fw-probe':{'baseUrl':'https://api.fireworks.ai/inference/v1','api':'openai-completions','apiKey':'$FIREWORKS_API_KEY','models':[{'id':MODEL,'name':'Planning','reasoning':False,'contextWindow':65536,'maxTokens':8192}]}}}))
        argv=['pi','--print','--mode','json','--no-extensions','--no-context-files','--no-prompt-templates','--no-session','--offline','--provider','fw-probe','--model',MODEL,'--thinking','minimal',prompt]
    else:
        env['OPENCODE_CONFIG_CONTENT']=json.dumps({'permission':{'*':'allow'},'share':'disabled','provider':{'fireworks':{'npm':'@ai-sdk/openai-compatible','options':{'baseURL':'https://api.fireworks.ai/inference/v1','apiKey':'{env:FIREWORKS_API_KEY}'},'models':{MODEL:{'name':'Planning','limit':{'context':65536,'output':8192}}}}}})
        argv=['opencode','run','--pure','--model','fireworks/'+MODEL,'--format','json',prompt]
    deny=[str(ROOT.parent),*[str(pathlib.Path.home()/name) for name in ['.codex','.claude','.agents']],str(DEST),'/tmp','/private/tmp']
    profile='(version 1) (allow default) (deny file-read* file-write* '+' '.join('(subpath '+json.dumps(p)+')' for p in deny)+')'
    for temporary in {str(work.parent),str(work.parent.resolve())}:
        profile+=' (deny file-read-data file-write* (require-all (subpath '+json.dumps(temporary)+') (require-not (subpath '+json.dumps(str(work.resolve()))+'))))'
    profile+=' (deny file-write* (require-all (require-not (subpath '+json.dumps(str(work.resolve()))+')) (require-not (subpath '+json.dumps(str(work))+')) (require-not (literal "/dev/null")) (require-not (literal "/dev/tty"))))'
    argv=['/usr/bin/sandbox-exec','-p',profile,*argv]
    started=time.monotonic(); p=subprocess.Popen(argv,cwd=work,env=env,stdin=subprocess.DEVNULL,stdout=subprocess.PIPE,stderr=subprocess.PIPE,text=True,start_new_session=True)
    try: out,err=p.communicate(timeout=240)
    except subprocess.TimeoutExpired:
        os.killpg(p.pid,signal.SIGTERM); out,err=p.communicate(timeout=10)
    result={'harness':harness,'model':MODEL,'grammar':'gh-inspired' if baseline else 'git-style','seconds':round(time.monotonic()-started,2),'exit':p.returncode,'workspace':str(work),'stdout':out.replace(key,'[REDACTED]').replace(token,'[REDACTED]'),'stderr':err.replace(key,'[REDACTED]').replace(token,'[REDACTED]')}
    (DEST/(harness+'.json')).write_text(json.dumps(result,indent=2))
    final=json.loads((work/'.artifactbin/lock.json').read_text()); checks={}
    for name in ['report','restore','conflict']:
        state=final.get(name+'.jsx'); d=api('/api/artifacts/'+state['id'],token) if state else {}
        checks[name]= ('Revenue: 42.' in d.get('markup','') and 'style=' not in d.get('markup','')) if name=='report' else ('Original release.' in d.get('markup','') and d.get('version',0)>=3) if name=='restore' else ('Owner: Bob; budget: 20.' in d.get('markup',''))
    before=(work/'.artifactbin/requests.jsonl').read_text(); cli('status');
    try: cli(*(['artifact','edit'] if baseline else ['push'])); checks['offline_noop']=before==(work/'.artifactbin/requests.jsonl').read_text()
    except RuntimeError: checks['offline_noop']=False
    result['checks']=checks; result['requests']=[json.loads(l) for l in before.splitlines()]; (DEST/(harness+'.json')).write_text(json.dumps(result,indent=2))
    return {k:v for k,v in result.items() if k not in ['stdout','stderr','requests']}
print('RESULT_DIR',str(DEST),flush=True)
with concurrent.futures.ThreadPoolExecutor(max_workers=2) as pool:
    for r in pool.map(run,os.environ.get('PROBE_HARNESSES','pi,opencode').split(',')): print(json.dumps(r),flush=True)
