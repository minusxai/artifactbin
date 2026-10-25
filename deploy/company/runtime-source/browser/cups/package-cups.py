"""Preserve original libcups Debian package contract and replace actual shared ABI."""
import hashlib,json,os,re,shutil,subprocess,sys
from pathlib import Path

def run(*cmd):return subprocess.check_output(cmd,text=True).strip()
def copy(s,d):
 d.parent.mkdir(parents=True,exist_ok=True)
 if d.exists() or d.is_symlink():d.unlink()
 shutil.copy2(s,d,follow_symlinks=False)
def exports(p):return sorted({tuple(x.split()[-2:]) for x in run('objdump','-T',str(p)).splitlines() if len(x.split())>=7 and '*UND*' not in x and '*ABS*' not in x})
def needed(p):return re.findall(r'\(NEEDED\).*\[(.*?)\]',run('readelf','-d',str(p)))
mode,arg=sys.argv[1:];package='libcups2t64';version='2.4.20-1+runtime1';arch=run('dpkg','--print-architecture');triplet=run('dpkg-architecture','-qDEB_HOST_MULTIARCH');library=Path('/usr/lib')/triplet/'libcups.so.2'
if mode=='snapshot':
 profile_path=os.environ.get('RUNTIME_PROFILE_TSV')
 assert profile_path,'Explicit pre-bootstrap runtime profile is required'
 profile=dict(line.split('\t',1) for line in Path(profile_path).read_text().splitlines())
 for name,expected in profile.items():assert run('dpkg-query','-W','-f=${Version}',name)==expected,('Bootstrap changed runtime package',name,expected)
 assert package in profile
 files=run('dpkg-query','-L',package).splitlines();controls={}
 for suffix in ['preinst','postinst','prerm','postrm','triggers','conffiles','shlibs','symbols']:
  for p in [Path('/var/lib/dpkg/info')/(package+':'+arch+'.'+suffix),Path('/var/lib/dpkg/info')/(package+'.'+suffix)]:
   if p.exists():controls[suffix]={'text':p.read_text(),'mode':p.stat().st_mode&0o7777};break
 data={'status':run('dpkg-query','-s',package),'files':files,'controls':controls,'exports':exports(library),'needed':needed(library),'library_sha256':hashlib.sha256(library.read_bytes()).hexdigest(),'library_mode':library.stat().st_mode&0o7777,'library_uid':library.stat().st_uid,'library_gid':library.stat().st_gid}
 Path(arg).write_text(json.dumps(data,indent=2)+'\n');sys.exit()
assert mode=='package';data=json.loads(Path(arg).read_text());root=Path('/cups-work/package');root.mkdir(parents=True,exist_ok=True);new=Path('/cups-work/stage')/library.relative_to('/')
missing=set(tuple(x) for x in data['exports'])-set(tuple(x) for x in exports(new));assert not missing,missing
assert '(SONAME)' in run('readelf','-d',str(new)) and '[libcups.so.2]' in run('readelf','-d',str(new))
assert set(data['needed'])<=set(needed(new)),(data['needed'],needed(new))
assert any('gnutls' in x for x in needed(new)),needed(new)
for path in data['files']:
 old=Path(path)
 if not(old.is_file() or old.is_symlink()):continue
 if old.name.startswith('libcups.so.'):
  if old.is_symlink():copy(old,root/old.relative_to('/'))
  elif old==library:copy(new,root/old.relative_to('/'))
  else:raise AssertionError('Unexpected second libcups payload '+path)
 else:copy(old,root/old.relative_to('/'))
installed=root/library.relative_to('/');os.chown(installed,data['library_uid'],data['library_gid']);installed.chmod(data['library_mode'])
doc=root/'usr/share/doc'/package;doc.mkdir(parents=True,exist_ok=True);copy(Path('/cups-work/cups-2.4.20/LICENSE'),doc/'LICENSE.upstream');copy(Path(__file__).parent/'SHA256SUMS',doc/'runtime-recipe-SHA256SUMS')
(doc/'runtime-source.json').write_text(json.dumps({'source':'cups','version':version,'source_url':'https://github.com/OpenPrinting/cups/releases/tag/v2.4.20','source_sha256':'ab4d9cd7f3e58060091d2b24972223d6401675f11c49b65abf4f6ef31dea22ff','library_sha256':hashlib.sha256(new.read_bytes()).hexdigest(),'original_library_sha256':data['library_sha256'],'retained_soname':'libcups.so.2','needed':needed(new),'packaged_components':'client shared library only; no daemon/backend/tool introduced'},indent=2)+'\n')
Path('debian').mkdir(exist_ok=True);Path('debian/control').write_text('Source: cups\nMaintainer: Runtime Maintainers <maintainers@example.invalid>\n\nPackage: libcups2t64\nArchitecture: any\nDescription: shared runtime\n')
deps=next(x.split('=',1)[1] for x in run('dpkg-shlibdeps','-O','-x'+package,'-e'+str(installed)).splitlines() if x.startswith('shlibs:Depends='));assert deps
control=root/'DEBIAN';control.mkdir();fields={};key=None
for line in data['status'].splitlines():
 if line.startswith((' ','\t')):
  if key in fields:fields[key]+='\n'+line
 elif ': ' in line:
  key,value=line.split(': ',1)
  if key in ['Package','Section','Priority','Essential','Multi-Arch','Provides','Breaks','Replaces','Pre-Depends','Depends','Conflicts','Recommends','Suggests','Enhances','Homepage']:fields[key]=value
fields.update(Package=package,Source='cups',Version=version,Architecture=arch,Maintainer='Runtime Maintainers <maintainers@example.invalid>',Description='Verified upstream CUPS client shared runtime')
fields['Depends']=', '.join(dict.fromkeys(x.strip() for x in (fields.get('Depends','')+','+deps).split(',') if x.strip()))
for suffix,item in data['controls'].items():
 text=item['text']
 if suffix=='shlibs':text='libcups 2 libcups2t64 (>= '+version+')\n'
 (control/suffix).write_text(text);(control/suffix).chmod(item['mode'])
(control/'control').write_text(''.join(k+': '+v+'\n' for k,v in fields.items()))
(control/'md5sums').write_text(''.join(hashlib.md5(p.read_bytes()).hexdigest()+'  '+str(p.relative_to(root))+'\n' for p in sorted(root.rglob('*')) if p.is_file() and not p.is_symlink() and control not in p.parents))
subprocess.run(['dpkg-deb','--build',str(root),'/out/libcups2t64.deb'],check=True)
