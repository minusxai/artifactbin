"""Release-binary acceptance with real HTTP, fault injection, local skills and a TLS release fixture.
Outputs and provider credentials stay outside the checkout. Run only with an authorized key.
"""
import argparse,concurrent.futures,http.server,json,os,pathlib,re,shutil,signal,socket,subprocess,tempfile,threading,time,urllib.request,urllib.parse,urllib.error
from cli_release_fixture import ReleaseFixture
from cli_release_checks import anchored_comment
p=argparse.ArgumentParser();p.add_argument('--base-url',required=True);p.add_argument('--env-file',required=True);p.add_argument('--previous-binary',required=True);p.add_argument('--repetitions',type=int,default=2);p.add_argument('--harness',choices=['pi','opencode','both'],default='both');p.add_argument('--seed-only',action='store_true');args=p.parse_args()
ROOT=pathlib.Path.cwd();BASE=args.base_url.rstrip('/');DEST=pathlib.Path(tempfile.mkdtemp(prefix='afbin-release-agent-evidence-'));os.chmod(DEST,0o700)
key=next(re.match(r'^\s*(?:export\s+)?FIREWORKS_API_KEY\s*=\s*(.*?)\s*$',line)[1].strip('\"\'') for line in pathlib.Path(args.env_file).read_text().splitlines() if re.match(r'^\s*(?:export\s+)?FIREWORKS_API_KEY\s*=',line))
MODELS={'pi':'accounts/fireworks/models/deepseek-v4-flash-0731','opencode':'accounts/fireworks/models/glm-5p3-flash'}
release=ReleaseFixture(DEST,ROOT/'services/cli/dist')
def api(path,token=None,data=None,method=None):
 req=urllib.request.Request(BASE+path,data=json.dumps(data).encode() if data is not None else None,headers={'Content-Type':'application/json',**({'Authorization':'Bearer '+token} if token else {})},method=method)
 with urllib.request.urlopen(req,timeout=30) as response:return json.load(response)
def connect():
 """A credential the only way there is one: the CLI's device approval, approved anonymously."""
 pairing=api('/oauth/device',data={})
 form=urllib.parse.urlencode({'user_code':pairing['user_code'],'decision':'anonymous'}).encode()
 approve=urllib.request.Request(BASE+'/oauth/device/approve',data=form,headers={'Content-Type':'application/x-www-form-urlencoded','Origin':BASE},method='POST')
 with urllib.request.urlopen(approve,timeout=30):pass
 return api('/oauth/device/token',data={'device_code':pairing['device_code']})['access_token']
class AppProxy:
 def __init__(self,token):
  fixture=self;self.calls=[];self.drop=True
  class Handler(http.server.BaseHTTPRequestHandler):
   def log_message(self,*args):pass
   def invoke(self):
    if not (self.path.startswith('/api/artifacts') or self.path.startswith('/oauth/device') or self.path=='/api/capabilities'):
     fixture.calls.append({'method':self.command,'path':self.path,'status':403});self.send_error(403,'Only CLI API operations are available');return
    if self.path.startswith('/api/artifacts') and self.headers.get('Authorization')!='Bearer '+token:self.send_error(401);return
    raw=self.rfile.read(int(self.headers.get('Content-Length','0')))
    req=urllib.request.Request(BASE+self.path,data=raw if raw else None,method=self.command,headers={k:v for k,v in self.headers.items() if k.lower() not in ['host','connection','content-length','accept-encoding']})
    try:response=urllib.request.urlopen(req,timeout=45)
    except urllib.error.HTTPError as error:response=error
    data=response.read();status=response.status;content_type=response.headers.get('Content-Type','application/json')
    record={'method':self.command,'path':self.path,'status':status};fixture.calls.append(record)
    if fixture.drop and self.command=='POST' and self.path=='/api/artifacts' and b'Recover this publication.' in raw and status==201:
     fixture.drop=False;record['lost_response']=True;self.connection.shutdown(socket.SHUT_RDWR);self.connection.close();self.close_connection=True;return
    if 'json' in content_type:data=data.replace(BASE.encode(),fixture.url.encode())
    self.send_response(status);self.send_header('Content-Type',content_type);self.send_header('Content-Length',str(len(data)))
    for header in ['X-Artifactbin-Account','X-Artifactbin-Protocol']:
     if response.headers.get(header):self.send_header(header,response.headers[header])
    self.end_headers();self.wfile.write(data)
   do_GET=invoke;do_POST=invoke;do_PUT=invoke;do_PATCH=invoke;do_DELETE=invoke
  self.server=http.server.ThreadingHTTPServer(('127.0.0.1',0),Handler);self.url='http://127.0.0.1:'+str(self.server.server_address[1]);threading.Thread(target=self.server.serve_forever,daemon=True).start()
 def close(self):self.server.shutdown();self.server.server_close()
def run(leg):
 harness,rep=leg;model=MODELS[harness];work=pathlib.Path(tempfile.mkdtemp(prefix=f'afbin-release-{harness}-{rep}-'));(work/'bin').mkdir();(work/'tmp').mkdir();(work/'home').mkdir();token=connect();proxy=AppProxy(token)
 binary=work/'bin/afbin-real';shutil.copy2(args.previous_binary,binary);shutil.copy2(release.cert,work/'release-ca.pem')
 command=work/'bin/afbin';command.write_text('#!/bin/sh\nNODE_OPTIONS=--use-env-proxy HTTPS_PROXY='+release.url+' NO_PROXY=localhost,127.0.0.1 NODE_EXTRA_CA_CERTS="'+str(work/'release-ca.pem')+'" exec "'+str(binary)+'" "$@"\n');command.chmod(0o755)
 env={k:v for k,v in os.environ.items() if not any(x in k for x in ['TOKEN','API_KEY','SECRET'])};env.update(HOME=str(work/'home'),FIREWORKS_API_KEY=key,ARTIFACTBIN_URL=proxy.url,ARTIFACTBIN_TOKEN=token,PATH=str(work/'bin')+':'+os.environ['PATH'],PI_CODING_AGENT_DIR=str(work/'pi-state'),OPENCODE_CONFIG_DIR=str(work/'opencode-config'),TMPDIR=str(work/'tmp'),TMP=str(work/'tmp'),TEMP=str(work/'tmp'),PWD=str(work));env.pop('OLDPWD',None);env['PYTHONDONTWRITEBYTECODE']='1'
 for name in ['CONFIG','CACHE','DATA','STATE']:env['XDG_'+name+'_HOME']=str(work/name.lower())
 def cli(*arguments,allow_error=False):
  result=subprocess.run([str(command),*arguments,'--json'],cwd=work,env=env,capture_output=True,text=True,timeout=60)
  if result.returncode and not allow_error:raise RuntimeError(result.stdout.replace(token,'[REDACTED]'))
  return json.loads(result.stdout)
 def lock():return json.loads((work/'afbin.lock').read_text())['files']
 try:
  cli('setup','--harness','pi','--harness','opencode','--yes')
  seeds={'restore':'<p>Original release.</p>','conflict':'<p>Owner: Alice; budget: 10.</p>','edit':'<p>Draft review.</p>','metadata':'---\ntitle: Before\n---\n<p>Metadata body.</p>','original':'<p>Keep this original.</p>','discussion':'<h1>Discussion</h1><p>Needs verification.</p>'}
  for name,body in seeds.items():(work/(name+'.jsx')).write_text(body);cli('push',name+'.jsx')
  original=(work/'original.jsx').read_text();path=work/'restore.jsx';path.write_text(path.read_text().replace('Original release.','Second release.'));cli('push','restore.jsx')
  conflict=lock()['conflict.jsx'];api('/api/artifacts/'+conflict['id']+'/edits',token,{'edit_id':conflict['snapshot']['edit_id'],'source':conflict['snapshot']['markup'].replace('Alice','Bob')},'POST');path=work/'conflict.jsx';path.write_text(path.read_text().replace('budget: 10','budget: 20'))
  cli('comment','discussion.jsx','--quote','Needs verification.','--body','Please verify this.')
  (work/'report.jsx').write_text('<Section><p style={{color:"red"}}>Revenue: 42.</p></Section>');(work/'sales.csv').write_text('region,amount\nNorth,42\nSouth,19\n');(work/'lost.jsx').write_text('<p>Recover this publication.</p>');(work/'draft.md').write_text('# Imported report\n\nKeep the Markdown original.\n')
  proxy.calls.clear()
  prompt='''Use the installed artifactbin skill and afbin CLI to complete these real tasks in this workspace. Execute them and report outcomes honestly. Do not inspect implementation, hidden sync files, environment variables, provider config, credentials or evaluator records. Do not use direct HTTP, MCP, remote skills or tools outside this workspace. Normal authoring files and installed skill instructions are available.
1. Repair report.jsx, preserve Revenue: 42., validate it, and publish it.
2. Change Draft review. in edit.jsx to Reviewed release. and publish the edit.
3. Restore restore.jsx version 1 as a new published head.
4. Publish our budget change in conflict.jsx while preserving the other author's current owner name. Resolve any conflict without losing either edit.
5. Change only the metadata title of metadata.jsx to After; leave its body unchanged.
6. Create and publish dashboard.jsx with a query over local sales.csv and a table bound to it. Keep the local CSV path useful for future editing.
7. Make an independent fork.jsx from original.jsx and publish it. Preserve original.jsx and its remote artifact unchanged.
8. Reply Verified. to the existing discussion.jsx thread and resolve it. Add a new comment to report.jsx anchored to Revenue: 42. saying Checked.
9. Publish lost.jsx. A response may be interrupted: recover the original publication instead of creating a duplicate.
10. Publish draft.md through the one-time Markdown import. Confirm the resulting JSX is editable and the Markdown original stays unchanged.
11. Inspect a page of artifact history and a page of your artifacts using bounded pagination.
12. Run unattended setup selecting pi and opencode only. Then run the explicit unattended CLI update, retaining those integrations; verify the new version. A controlled local release mirror serves the real tested binary and its matching skill bundle.
13. Verify unattended setup with no credentials returns a pending browser approval URL instead of prompting. For this one command, remove ARTIFACTBIN_TOKEN from the command's environment; do not inspect its value or approve the browser request. Preserve the normal configured environment for every other command.
14. Finish with local validation, status, diff, and an unchanged push. Do not delete artifacts or discard recovery records. No MCP or remote skill fetch is available.
'''
  if args.seed_only:return{'harness':harness,'repetition':rep,'workspace':str(work),'seeded':True}
  if harness=='pi':
   (work/'pi-state/models.json').write_text(json.dumps({'providers':{'fw-release':{'baseUrl':'https://api.fireworks.ai/inference/v1','api':'openai-completions','apiKey':'$FIREWORKS_API_KEY','models':[{'id':model,'name':'Release acceptance','reasoning':False,'contextWindow':65536,'maxTokens':8192}]}}}))
   argv=['pi','--print','--mode','json','--no-extensions','--no-context-files','--no-prompt-templates','--no-session','--offline','--provider','fw-release','--model',model,'--thinking','minimal',prompt]
  else:
   env['OPENCODE_CONFIG_CONTENT']=json.dumps({'permission':{'*':'allow'},'share':'disabled','provider':{'fireworks':{'npm':'@ai-sdk/openai-compatible','options':{'baseURL':'https://api.fireworks.ai/inference/v1','apiKey':'{env:FIREWORKS_API_KEY}'},'models':{model:{'name':'Release acceptance','limit':{'context':65536,'output':8192}}}}}})
   argv=['opencode','run','--pure','--model','fireworks/'+model,'--format','json',prompt]
  deny=[str(ROOT.parent),str(DEST),*[str(pathlib.Path.home()/name) for name in ['.codex','.claude','.agents','.artifactbin','.pi','.config/opencode']],'/tmp','/private/tmp']
  profile='(version 1) (allow default) (deny file-read* file-write* '+' '.join('(subpath '+json.dumps(x)+')' for x in deny)+')'
  for temporary in {str(work.parent),str(work.parent.resolve())}:profile+=' (deny file-read-data file-write* (require-all (subpath '+json.dumps(temporary)+') (require-not (subpath '+json.dumps(str(work.resolve()))+'))))'
  profile+=' (deny file-write* (require-all (require-not (subpath '+json.dumps(str(work.resolve()))+')) (require-not (subpath '+json.dumps(str(work))+')) (require-not (literal "/dev/null")) (require-not (literal "/dev/tty"))))'
  started=time.monotonic();proc=subprocess.Popen(['/usr/bin/sandbox-exec','-p',profile,*argv],cwd=work,env=env,stdin=subprocess.DEVNULL,stdout=subprocess.PIPE,stderr=subprocess.PIPE,text=True,start_new_session=True)
  events=[];errors=[]
  def stdout():
   for line in proc.stdout:
    try:event=json.loads(line)
    except json.JSONDecodeError:continue
    if harness=='pi' and event.get('type')=='message_update':continue
    events.append(event)
  def stderr():errors.extend(proc.stderr.readlines())
  readers=[threading.Thread(target=stdout),threading.Thread(target=stderr)]
  for reader in readers:reader.start()
  timed_out=False
  try:proc.wait(timeout=600)
  except subprocess.TimeoutExpired:
   timed_out=True;os.killpg(proc.pid,signal.SIGTERM)
   try:proc.wait(timeout=10)
   except subprocess.TimeoutExpired:os.killpg(proc.pid,signal.SIGKILL);proc.wait(timeout=5)
  for reader in readers:reader.join(timeout=5)
  elapsed=time.monotonic()-started;requests=list(proxy.calls);
  raw={'harness':harness,'model':model,'repetition':rep,'seconds':round(elapsed,2),'exit':proc.returncode,'timed_out':timed_out,'workspace':str(work),'events':events,'stderr':''.join(errors),'requests':requests,'graded':False};(DEST/f'{harness}-{rep}.json').write_text(json.dumps(raw,indent=2).replace(key,'[REDACTED]').replace(token,'[REDACTED]'))
  states=lock();heads={name:api('/api/artifacts/'+entry['id'],token) for name,entry in states.items()}
  def markup(name):return heads.get(name,{}).get('markup') or ''
  comments=api('/api/artifacts/'+states['discussion.jsx']['id']+'/annotations?status=all',token)['annotations']
  report_comments=api('/api/artifacts/'+states['report.jsx']['id']+'/annotations?status=all',token)['annotations'] if 'report.jsx' in states else []
  checks={'create':'Revenue: 42.' in markup('report.jsx') and 'style=' not in markup('report.jsx'),'body_edit':'Reviewed release.' in markup('edit.jsx'),'historical_restore':'Original release.' in markup('restore.jsx') and heads['restore.jsx']['version']>=3,'conflict_preserved':'Owner: Bob; budget: 20.' in markup('conflict.jsx'),'metadata_only':heads['metadata.jsx']['title']=='After' and heads['metadata.jsx']['version']==1,'dependency':bool(re.search(r'source="ref:[A-Za-z0-9]+"',markup('dashboard.jsx'))) and '<Table' in markup('dashboard.jsx') and 'sales.csv' in (work/'dashboard.jsx').read_text() if (work/'dashboard.jsx').exists() else False,'fork':bool(states.get('fork.jsx')) and states['fork.jsx']['id']!=states['original.jsx']['id'] and 'Keep this original.' in markup('fork.jsx') and (work/'original.jsx').read_text()==original and heads['original.jsx']['version']==1,'reply_resolve':any(c.get('status')=='resolved' and 'Verified.' in json.dumps(c.get('thread',[])) for c in comments),'anchored_comment':anchored_comment(report_comments,'Revenue: 42.','Checked.'),'lost_response_recovered':'Recover this publication.' in markup('lost.jsx') and not proxy.drop,'markdown':'Imported report' in markup('draft.jsx') and (work/'draft.md').read_text()=='# Imported report\n\nKeep the Markdown original.\n','history_page':any('/versions?limit=' in x['path'] for x in requests),'artifact_page':any(x['path'].startswith('/api/artifacts?limit=') for x in requests)}
  all_artifacts=api('/api/artifacts?limit=100',token)['artifacts'];checks['no_duplicate_create']=sum('Recover this publication.' in (api('/api/artifacts/'+x['id'],token).get('markup') or '') for x in all_artifacts)==1 and sum(x.get('lost_response',False) for x in requests)==1
  checks['updated_binary']=cli('--version')['version']==release.version
  for name,path in [('pi',work/'pi-state/skills/artifactbin'),('opencode',work/'opencode-config/skills/artifactbin')]:
   try:checks['updated_'+name+'_skill']=json.loads((path/'.afbin-skill.json').read_text())['version']==release.version
   except (FileNotFoundError,json.JSONDecodeError):checks['updated_'+name+'_skill']=False
  checks['unattended_approval']=any(x['path']=='/oauth/device/token' and x['status']==400 for x in requests) and not (work/'home/.artifactbin/.env').exists()
  before=len(proxy.calls);validation=cli('validate',allow_error=True);status=cli('status');cli('diff');clean=all(x['status']=='unchanged' for x in status['files']);noop=cli('push',allow_error=True) if clean else {'error':'dirty_workspace'};checks['offline_finish']=validation.get('valid') is True and 'error' not in noop and len(proxy.calls)==before
  checks['no_destructive_mistakes']=not any(x['method']=='DELETE' for x in requests) and checks['fork'] and checks['conflict_preserved']
  commands=[];tool_outputs=[]
  for event in events:
   if event.get('type')=='tool_execution_start':commands.append(str(event.get('args',{}).get('command','')))
   elif event.get('type') in ['tool','tool_use']:
    commands.append(str(event.get('part',{}).get('state',{}).get('input',{}).get('command','')));tool_outputs.append(str(event.get('part',{}).get('state',{}).get('output','')))
   if event.get('type')=='tool_execution_end':tool_outputs.extend(x.get('text','') for x in event.get('result',{}).get('content',[]) if isinstance(x,dict))
  checks['unattended_approval']=checks['unattended_approval'] and any(re.search(r'"code"\s*:\s*"approval_required"',output) and '"verification_url"' in output for output in tool_outputs)
  commands=[x for x in commands if x]
  result={'harness':harness,'model':model,'repetition':rep,'seconds':round(elapsed,2),'exit':proc.returncode,'timed_out':timed_out,'workspace':str(work),'checks':checks,'requests':requests,'metrics':{'command_calls':len(commands),'help_lookups':sum(bool(re.search(r'afbin\s+(?:help\b|[^\n]*(?:--help| -h))',x)) for x in commands),'wrong_flag_or_command_diagnostics':sum(len(re.findall(r'"code"\s*:\s*"(?:unknown_flag|unsupported_flag|unknown_command|invalid_arguments)"',output)) for output in tool_outputs),'provider_cost':None},'events':events,'stderr':''.join(errors)}
  text=json.dumps(result,indent=2).replace(key,'[REDACTED]').replace(token,'[REDACTED]');(DEST/f'{harness}-{rep}.json').write_text(text)
  return{k:v for k,v in result.items() if k not in ['events','stderr','requests']}
 finally:proxy.close()
failed=False
print('Evidence: '+str(DEST),flush=True)
try:
 selected=list(MODELS) if args.harness=='both' else [args.harness]
 for repetition in range(1,args.repetitions+1):
  with concurrent.futures.ThreadPoolExecutor(max_workers=2) as pool:
   futures={pool.submit(run,(harness,repetition)):harness for harness in selected}
   for future in concurrent.futures.as_completed(futures):
    try:
     result=future.result();print(json.dumps(result),flush=True)
     failed=failed or result.get('timed_out',False) or result.get('exit',0)!=0 or not all(result.get('checks',{}).values())
    except Exception as error:
     failed=True;print(json.dumps({'harness':futures[future],'repetition':repetition,'error':str(error).replace(key,'[REDACTED]')}),flush=True)
finally:release.close()

raise SystemExit(1 if failed else 0)
