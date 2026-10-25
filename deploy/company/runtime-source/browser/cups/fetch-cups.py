"""Fetch vendor-digest pinned CUPS source/signature from official release assets."""
import hashlib,json,shutil,sys,urllib.request
from pathlib import Path
here,out=map(Path,sys.argv[1:]);out.mkdir(parents=True,exist_ok=True)
for a in json.loads((here/'downloads.json').read_text()):
 target=out/a['name'];local=here/a['name']
 if local.exists():shutil.copyfile(local,target)
 else:
  with urllib.request.urlopen(a['browser_download_url'],timeout=120) as src,target.open('wb') as dest:shutil.copyfileobj(src,dest)
 assert 'sha256:'+hashlib.sha256(target.read_bytes()).hexdigest()==a['digest'],a['name']
