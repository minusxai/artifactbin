"""Core CLI usability trials; output stays outside the checkout. Not the final release gate."""
import argparse, concurrent.futures, json, os, pathlib, re, shutil, signal, subprocess, tempfile, time
p=argparse.ArgumentParser();p.add_argument('--env-file',required=True);args=p.parse_args()
root=pathlib.Path.cwd();dest=pathlib.Path(tempfile.mkdtemp(prefix='afbin-core-evidence-'))
match=next(re.match(r'^\s*(?:export\s+)?FIREWORKS_API_KEY\s*=\s*(.*?)\s*$',line) for line in pathlib.Path(args.env_file).read_text().splitlines() if re.match(r'^\s*(?:export\s+)?FIREWORKS_API_KEY\s*=',line));key=match[1].strip('\"\'')
models={'pi':'accounts/fireworks/models/deepseek-v4-flash-0731','opencode':'accounts/fireworks/models/glm-5p3-flash'}
def run(harness):
 work=pathlib.Path(tempfile.mkdtemp(prefix='afbin-core-'+harness+'-'));(work/'bin').mkdir();(work/'tmp').mkdir()
 shutil.copy(root/'services/cli/dist/afbin.mjs',work/'bin/cli.mjs');binary=work/'bin/afbin';binary.write_text('#!/bin/sh\nexec '+shutil.which('node')+' "'+str(work/'bin/cli.mjs')+'" "$@"\n');binary.chmod(0o755)
 env={k:v for k,v in os.environ.items() if not any(s in k for s in ['TOKEN','API_KEY','SECRET'])};env.update(FIREWORKS_API_KEY=key,PATH=str(work/'bin')+':'+os.environ['PATH'],PI_CODING_AGENT_DIR=str(work/'pi-state'),OPENCODE_CONFIG_DIR=str(work/'opencode-config'),TMPDIR=str(work/'tmp'),TMP=str(work/'tmp'),TEMP=str(work/'tmp'),PWD=str(work));env.pop('OLDPWD',None)
 for k in ['CONFIG','CACHE','DATA','STATE']:env['XDG_'+k+'_HOME']=str(work/k.lower())
 skill=work/('pi-state/skills/artifactbin' if harness=='pi' else '.opencode/skills/artifactbin');skill.mkdir(parents=True)
 (skill/'SKILL.md').write_text('---\nname: artifactbin\ndescription: Author and publish artifactbin documents with the local afbin CLI.\n---\nUse afbin -h and afbin help for the local command and markup grammar. Do not use MCP or remote skills. Edit ordinary files, validate locally, then push when asked.\n')
 (work/'sales.csv').write_text('region,amount\nNorth,42\nSouth,19\n')
 original='---\nid: abc123\nedit_id: original\nhead_version: 3\nstate: '+'a'*64+'\nversion: 1\n---\n<p>Keep this original.</p>\n';(work/'original.jsx').write_text(original)
 (work/'report.jsx').write_text('<Section><p style={{color:"red"}}>Revenue report</p></Section>')
 prompt='''Use the installed artifactbin skill and afbin CLI to perform these LOCAL tasks. Stay in this workspace. Do not inspect CLI implementation, hidden state, environment variables or credentials. Do not use HTTP, MCP or remote skills. Do not publish or authenticate.\n1. Repair report.jsx so it validates and still says Revenue report. Add a query over the local sales.csv and a table bound to that query; keep the CSV local and use the current published-reference grammar where relevant. Select a supported theme using local help.\n2. Make an independent new document fork.jsx by copying original.jsx and removing every server identity/sync field, preserving its text. Do not alter original.jsx.\n3. Validate both files, apply available mechanical fixes, and finish with local status. Report failures honestly.\n'''
 model=models[harness]
 if harness=='pi':
  (work/'pi-state/models.json').write_text(json.dumps({'providers':{'fw-core':{'baseUrl':'https://api.fireworks.ai/inference/v1','api':'openai-completions','apiKey':'$FIREWORKS_API_KEY','models':[{'id':model,'name':'Core trial','reasoning':False,'contextWindow':65536,'maxTokens':8192}]}}}))
  command=['pi','--print','--mode','json','--no-extensions','--no-context-files','--no-prompt-templates','--no-session','--offline','--provider','fw-core','--model',model,'--thinking','minimal',prompt]
 else:
  env['OPENCODE_CONFIG_CONTENT']=json.dumps({'permission':{'*':'allow'},'share':'disabled','provider':{'fireworks':{'npm':'@ai-sdk/openai-compatible','options':{'baseURL':'https://api.fireworks.ai/inference/v1','apiKey':'{env:FIREWORKS_API_KEY}'},'models':{model:{'name':'Core trial','limit':{'context':65536,'output':8192}}}}}})
  command=['opencode','run','--pure','--model','fireworks/'+model,'--format','json',prompt]
 deny=[str(root.parent),str(dest),*[str(pathlib.Path.home()/name) for name in ['.codex','.claude','.agents']],'/tmp','/private/tmp']
 profile='(version 1) (allow default) (deny file-read* file-write* '+' '.join('(subpath '+json.dumps(x)+')' for x in deny)+')'
 for temporary in {str(work.parent),str(work.parent.resolve())}:profile+=' (deny file-read-data file-write* (require-all (subpath '+json.dumps(temporary)+') (require-not (subpath '+json.dumps(str(work.resolve()))+'))))'
 profile+=' (deny file-write* (require-all (require-not (subpath '+json.dumps(str(work.resolve()))+')) (require-not (subpath '+json.dumps(str(work))+')) (require-not (literal "/dev/null")) (require-not (literal "/dev/tty"))))'
 started=time.monotonic();proc=subprocess.Popen(['/usr/bin/sandbox-exec','-p',profile,*command],cwd=work,env=env,stdin=subprocess.DEVNULL,stdout=subprocess.PIPE,stderr=subprocess.PIPE,text=True,start_new_session=True)
 try:out,err=proc.communicate(timeout=240)
 except subprocess.TimeoutExpired:os.killpg(proc.pid,signal.SIGTERM);out,err=proc.communicate(timeout=10)
 grade=subprocess.run([str(binary),'validate','report.jsx','fork.jsx','--json'],cwd=work,env={k:v for k,v in env.items() if k!='FIREWORKS_API_KEY'},capture_output=True,text=True)
 report=(work/'report.jsx').read_text();fork=(work/'fork.jsx').read_text() if (work/'fork.jsx').exists() else ''
 checks={'valid':grade.returncode==0,'original_unchanged':(work/'original.jsx').read_text()==original,'fork_has_text':'Keep this original.' in fork,'fork_drops_identity':bool(fork) and not re.search(r'^(id|edit_id|head_version|state|version):',fork,re.M),'local_query':bool(re.search(r'source\s*=\s*[\"\{].*sales\.csv',report)),'table_binding':'data=' in report and '$' in report,'preserved_title':'Revenue report' in report}
 result={'harness':harness,'model':model,'seconds':round(time.monotonic()-started,2),'exit':proc.returncode,'workspace':str(work),'checks':checks,'grade_stdout':grade.stdout,'stdout':out.replace(key,'[REDACTED]'),'stderr':err.replace(key,'[REDACTED]')};(dest/(harness+'.json')).write_text(json.dumps(result,indent=2));print(json.dumps({k:result[k] for k in ['harness','model','seconds','exit','checks']}),flush=True)
print('Evidence: '+str(dest),flush=True)
with concurrent.futures.ThreadPoolExecutor(max_workers=2) as pool:list(pool.map(run,models))
