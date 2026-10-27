import sys,pathlib,tempfile,json,unittest
sys.path.insert(0,str(pathlib.Path(__file__).resolve().parents[2]/'scripts/migration_batch'))
from conversion import prepare,accepted_ids,run
from preflight import reader_config
from runner import ref
class ConversionTests(unittest.TestCase):
 def setUp(self):self.tmp=tempfile.TemporaryDirectory();self.root=pathlib.Path(self.tmp.name)
 def tearDown(self):self.tmp.cleanup()
 def save(self,n,v):p=self.root/n;p.write_text(json.dumps(v));return ref(p)
 def config(self):
  plan=self.save('plan.json',{'revisionScope':'latest','heads':[{'key':{'sourceId':'sample','version':1}}]});reservation=self.save('reservation.json',{'conversionExecutor':'owner','artifacts':[{'key':{'sourceId':'sample','version':1}}]});accepted=self.save('accepted.json',{'sourceIds':[]});adapter=self.save('adapter.json',{});source=self.save('source.json',{})
  return {'format':'migration-conversion-batch-v1','owner':'owner','plan':plan,'reservation':reservation,'acceptedRoot':accepted,'adapter':[adapter],'items':[{'artifact':'sample','version':1,'inputs':[source],'command':['true'],'cwd':str(self.root),'output':str(self.root/'packet.json')}]}
 def test_resume_same_manifest_and_targeted_shared_fix(self):
  c=self.config();a=prepare(c,self.root/'manifests');b=prepare(c,self.root/'manifests');self.assertEqual(a,b);c['adapter']=[self.save('fixed.json',{'fix':1})];d=prepare(c,self.root/'manifests',only=['sample']);self.assertNotEqual(a[0][2],d[0][2]);self.assertTrue(a[0][1].exists())
 def test_source_drift_rejected(self):
  c=self.config();pathlib.Path(c['items'][0]['inputs'][0]['path']).write_text('{}changed')
  with self.assertRaisesRegex(ValueError,'input_changed'):prepare(c,self.root/'manifests')
 def test_accepted_skipped_and_chain_hash_required(self):
  c=self.config();c['acceptedRoot']=self.save('accepted2.json',{'additional':[{'sourceId':'sample'}],'prior':c['acceptedRoot']});self.assertEqual(prepare(c,self.root/'manifests'),[])
  pathlib.Path(c['acceptedRoot']['path']).write_text('{}')
  with self.assertRaisesRegex(ValueError,'accepted_chain_changed'):accepted_ids(c['acceptedRoot'])
 def test_outside_reservation_and_duplicates_rejected(self):
  c=self.config();c['items'][0]['version']=2
  with self.assertRaisesRegex(ValueError,'outside_reservation'):prepare(c,self.root/'manifests')
  c=self.config();c['items']*=2
  with self.assertRaisesRegex(ValueError,'duplicate_artifact'):prepare(c,self.root/'manifests')
 def test_real_fanout_resume_and_targeted_fix_preserve_other_output(self):
  c=self.config();c['plan']=self.save('plan393.json',{'revisionScope':'latest','heads':[{'key':{'sourceId':id,'version':1}}for id in ['sample','rejected']+[f'f{i}'for i in range(391)]]});c['reservation']=self.save('reservation2.json',{'conversionExecutor':'owner','artifacts':[{'key':{'sourceId':id,'version':1}}for id in ['sample','rejected']]})
  script=self.root/'adapter.py';script.write_text("import json,pathlib,sys\nid,out,log,fixed=sys.argv[1:]\nwith open(log,'a')as f:f.write(id+'\\n')\npathlib.Path(out).write_text(json.dumps({'status':'converted'if id=='sample'or fixed=='yes'else'exception','codes':[]if id=='sample'or fixed=='yes'else['unsupported'],'productionWrites':0,'acceptanceClaimed':False}))\n")
  c['adapter']=[ref(script)];c['items']=[]
  for id in ['sample','rejected']:
   c['items'].append({'artifact':id,'version':1,'inputs':[],'command':[sys.executable,str(script),id,str(self.root/(id+'.packet.json')),str(self.root/'calls'),'no'],'cwd':str(self.root),'output':str(self.root/(id+'.packet.json'))})
  db=self.root/'state.db';root=self.root/'batch';a=run(c,root,db);self.assertEqual((a['attempted'],a['converted'],a['exceptions']),(2,1,1));old=(self.root/'sample.packet.json').read_bytes();run(c,root,db);self.assertEqual((self.root/'calls').read_text().splitlines(),['sample','rejected'])
  item=c['items'][1];item['command'][-1]='yes';item['command'][3]=str(self.root/'rejected.fixed.json');item['output']=item['command'][3];b=run(c,root,db,only=['rejected']);self.assertEqual((b['attempted'],b['thisRunAttempted'],b['converted']),(2,1,2));self.assertEqual((self.root/'sample.packet.json').read_bytes(),old);self.assertEqual((self.root/'calls').read_text().splitlines(),['sample','rejected','rejected'])
 def test_reader_context_rejected_before_apply(self):
  context=self.save('context.json',{'format':'native-pipeline-host-context'})
  with self.assertRaisesRegex(ValueError,'reader_cli_config_shape'):reader_config(context['path'])
  p=self.save('batch.json',{});cli=self.save('cli.json',{'receiptRoot':str(self.root),'batchPath':p['path'],'planPath':p['path'],'outputDirectory':str(self.root/'output')});self.assertTrue(reader_config(cli['path'])['valid'])
if __name__=='__main__':unittest.main()
