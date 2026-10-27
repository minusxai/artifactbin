import hashlib,json,pathlib,sys,time,unittest
sys.path.insert(0,str(pathlib.Path(__file__).resolve().parents[2]/'scripts/migration_batch'))
import runner,reconcile
import test_runner as fixtures
put=fixtures.put

class ReconciliationTests(unittest.TestCase):
    setUp=fixtures.BatchTests.setUp
    tearDown=fixtures.BatchTests.tearDown
    def wait_job(self,id):
        for _ in range(200):
            s=runner.advance(self.db,id)
            if s['status']not in ['running','ready']:return s
            time.sleep(.02)
        self.fail('worker timeout')
    def fixture(self,write_failure=False):
        j=fixtures.BatchTests.job(self,kind='write',exit='75'if write_failure else'0');apply=j['steps'][0];apply['id']='apply'
        if not write_failure:
            read=json.loads(json.dumps(apply));read['id']='reader';read['kind']='read';read['command'][2]=str(self.root/'read-counter');read['command'][3]=str(self.root/'read-result.json');read['command'][5]='1';read['outputs'][0]['path']=str(self.root/'read-result.json');j['steps'].append(read)
        put(self.manifest,j);runner.enroll(self.db,self.manifest);runner.grant(self.db,{'format':'migration-batch-grant-v1','id':'g','coordinator':'coordinator','owner':'owner-a','jobSha256':runner.sha(self.manifest),'step':'apply','resource':'writer','expiresAt':time.time()+60});self.assertEqual(self.wait_job('pilot')['status'],'exception')
        original=runner.sha(self.manifest);target=apply if write_failure else j['steps'][1];recovery=json.loads(json.dumps(j));recovery['id']='recovery';step=json.loads(json.dumps(target));step['id']='correct-reader';step['kind']='read';step['command'][2]=str(self.root/'recovery-counter');step['command'][5]='0';step['outputs'][0]['assertions'][0]['equals']=True;recovery['steps']=[step];f=self.root/'recovery.json';put(f,recovery);runner.enroll(self.db,f);self.assertEqual(self.wait_job('recovery')['status'],'complete')
        return {'format':'migration-batch-reconciliation-v1','accepted':True,'reviewer':'reviewer','originalJob':'pilot','originalJobSha256':original,'recoveryJob':'recovery','recoveryJobSha256':runner.sha(f),'steps':{target['id']:'correct-reader'},'writerSafeToRelease':True}
    def test_reviewed_read_recovery_completes_without_reapplying(self):
        request=self.fixture();self.assertEqual(reconcile.resolve(self.db,request)['status'],'complete');self.assertEqual((self.root/'counter').read_text(),'1');self.assertEqual(runner.resources(self.db),[]);self.assertEqual(reconcile.resolve(self.db,request)['status'],'complete')
    def test_wrong_binding_keeps_writer_held(self):
        request=self.fixture();request['recoveryJobSha256']='0'*64
        with self.assertRaisesRegex(ValueError,'reconciliation_binding'):reconcile.resolve(self.db,request)
        self.assertEqual(len(runner.resources(self.db)),1)
    def test_reconciliation_recovers_receipt_before_sql_commit(self):
        request=self.fixture()
        def crash():raise RuntimeError('interrupted reconciliation')
        with self.assertRaisesRegex(RuntimeError,'interrupted'):reconcile.resolve(self.db,request,after_receipt=crash)
        self.assertEqual(len(runner.resources(self.db)),1);self.assertEqual(reconcile.resolve(self.db,request)['status'],'complete');self.assertEqual((self.root/'counter').read_text(),'1')
    def test_uncertain_write_is_never_adopted_from_read_recovery(self):
        request=self.fixture(write_failure=True)
        with self.assertRaisesRegex(ValueError,'read_recovery_only'):reconcile.resolve(self.db,request)
        self.assertEqual(len(runner.resources(self.db)),1)
