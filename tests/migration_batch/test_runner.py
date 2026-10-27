import hashlib,json,os,pathlib,subprocess,sys,tempfile,time,unittest
sys.path.insert(0,str(pathlib.Path(__file__).resolve().parents[2]/'scripts/migration_batch'))
import runner

def put(p,x):
    p.write_text(json.dumps(x));return {'path':str(p),'sha256':hashlib.sha256(p.read_bytes()).hexdigest()}

class BatchTests(unittest.TestCase):
    def setUp(self):
        self.tmp=tempfile.TemporaryDirectory();self.root=pathlib.Path(self.tmp.name);self.db=self.root/'state.db'
        self.plan=put(self.root/'plan.json',{'revisionScope':'latest','heads':[{'key':{'sourceId':f'item{i}','version':1}}for i in range(393)]})
        self.program=self.root/'command.py';self.program.write_text("import pathlib,json,sys,time\np=pathlib.Path(sys.argv[1]);n=int(p.read_text())+1 if p.exists() else 1;p.write_text(str(n));time.sleep(float(sys.argv[3]));pathlib.Path(sys.argv[2]).write_text(json.dumps({'complete':True,'attempt':n}));sys.exit(int(sys.argv[4]) if n==1 else 0)\n")
    def tearDown(self):self.tmp.cleanup()
    def job(self,kind='read',delay='0',exit='0',attempts=1):
        out=self.root/'result.json';step={'id':'prepare','kind':kind,'command':[sys.executable,str(self.program),str(self.root/'counter'),str(out),delay,exit],'cwd':str(self.root),'inputs':[{'path':str(self.program),'sha256':runner.sha(self.program)}],'outputs':[{'path':str(out),'assertions':[{'path':'complete','equals':True}]}],'maxAttempts':attempts,'retryExitCodes':[75]}
        if kind=='write':step['approval']=put(self.root/'existing-independent-approval.json',{'decision':'approved','artifact':'item0'})
        j={'format':'migration-batch-job-v1','id':'pilot','owner':'owner-a','artifact':'item0','version':1,'scope':'latest','plan':self.plan,'steps':[step]};self.manifest=self.root/'job.json';put(self.manifest,j);return j
    def enroll(self,j=None):
        if j:put(self.manifest,j)
        return runner.enroll(self.db,self.manifest)
    def wait(self):
        for _ in range(200):
            s=runner.advance(self.db,'pilot')
            if s['status']not in ['running','ready']:return s
            time.sleep(.02)
        self.fail('worker did not finish')
    def grant(self,resource='writer',step='prepare'):
        return runner.grant(self.db,{'format':'migration-batch-grant-v1','id':'grant1','coordinator':'coordinator','owner':'owner-a','jobSha256':runner.sha(self.manifest),'step':step,'resource':resource,'expiresAt':time.time()+60})
    def test_restart_finishes_exactly_once_and_seals_output(self):
        self.job(delay='.15');self.enroll();runner.advance(self.db,'pilot')
        # A second process resumes while detached worker is alive: no second invocation.
        subprocess.run([sys.executable,runner.__file__,'advance','--db',str(self.db),'--job','pilot'],check=True,stdout=subprocess.DEVNULL)
        self.assertEqual(self.wait()['status'],'complete');self.assertEqual((self.root/'counter').read_text(),'1')
        self.assertEqual(runner.advance(self.db,'pilot')['status'],'complete')
        (self.root/'result.json').write_text('{}')
        with self.assertRaisesRegex(ValueError,'output_changed'):runner.advance(self.db,'pilot')
    def test_input_change_rejected_before_command(self):
        self.job();self.enroll();self.program.write_text('changed')
        with self.assertRaisesRegex(ValueError,'input_changed'):runner.advance(self.db,'pilot')
        self.assertFalse((self.root/'counter').exists())
    def test_two_concurrent_controllers_launch_one_worker(self):
        self.job(delay='.15');self.enroll();commands=[[sys.executable,runner.__file__,'advance','--db',str(self.db),'--job','pilot']for _ in range(2)]
        processes=[subprocess.Popen(c,stdout=subprocess.DEVNULL)for c in commands]
        self.assertEqual([p.wait()for p in processes],[0,0]);self.assertEqual(self.wait()['status'],'complete');self.assertEqual((self.root/'counter').read_text(),'1')
    def test_enrollment_recovers_exact_manifest_left_before_transaction_commit(self):
        self.job();manifest=self.manifest.read_bytes();root=self.root/'jobs'/runner.digest('pilot')[:24];root.mkdir(parents=True);(root/'manifest.json').write_bytes(manifest)
        self.enroll();self.assertEqual(self.wait()['status'],'complete')
    def test_bounded_read_retry_but_never_write_retry(self):
        self.job(exit='75',attempts=2);self.enroll();self.assertEqual(self.wait()['status'],'complete');self.assertEqual((self.root/'counter').read_text(),'2')
    def test_write_failure_is_explicit_uncertain_exception(self):
        self.job(kind='write',exit='75');self.enroll();self.assertEqual(runner.advance(self.db,'pilot')['status'],'waiting_lease');self.grant();self.assertEqual(self.wait()['status'],'exception');self.assertEqual((self.root/'counter').read_text(),'1');self.assertEqual(runner.advance(self.db,'pilot')['status'],'exception');self.assertEqual(runner.resources(self.db)[0]['resource'],'writer')
    def test_no_config_can_enable_write_retry(self):
        self.job(kind='write',exit='75',attempts=2)
        with self.assertRaisesRegex(ValueError,'no_mutating_retry'):self.enroll()
    def test_invalid_output_is_not_success(self):
        j=self.job();j['steps'][0]['outputs'][0]['assertions'][0]['equals']=False;self.enroll(j)
        self.assertEqual(self.wait()['status'],'exception')
    def test_scope_and_membership_fail_closed(self):
        j=self.job();j['scope']='all'
        with self.assertRaisesRegex(ValueError,'latest_scope'):self.enroll(j)
        j['scope']='latest';j['artifact']='absent'
        with self.assertRaisesRegex(ValueError,'plan_membership'):self.enroll(j)
    def test_expired_or_wrong_owner_grant_rejected(self):
        self.job(kind='browser');self.enroll()
        g={'format':'migration-batch-grant-v1','id':'g','coordinator':'coordinator','owner':'other','jobSha256':runner.sha(self.manifest),'step':'prepare','resource':'browser-1','expiresAt':time.time()+60}
        with self.assertRaisesRegex(ValueError,'grant_binding'):runner.grant(self.db,g)
        g['owner']='owner-a';g['expiresAt']=0
        with self.assertRaisesRegex(ValueError,'grant_expired'):runner.grant(self.db,g)
    def test_atomic_slot_reservation_and_release(self):
        self.job(kind='browser',delay='.1');self.enroll();self.grant('browser-1');runner.advance(self.db,'pilot')
        with self.assertRaisesRegex(ValueError,'resource_busy'):self.grant('browser-1')
        self.assertEqual(self.wait()['status'],'complete');self.assertEqual(runner.resources(self.db),[])
    def test_one_writer_grant_spans_preflight_apply_and_readback(self):
        j=self.job(kind='write');second=json.loads(json.dumps(j['steps'][0]));second['id']='apply';second['command'][2]=str(self.root/'counter2');second['command'][3]=str(self.root/'result2.json');second['outputs'][0]['path']=str(self.root/'result2.json');j['steps'].append(second);self.enroll(j);self.grant()
        self.assertEqual(self.wait()['status'],'complete');self.assertEqual((self.root/'counter2').read_text(),'1');self.assertEqual(runner.resources(self.db),[])
    def test_review_packet_binds_exact_prior_outputs(self):
        j=self.job();j['steps'].append({'id':'accept','kind':'review','inputs':[],'outputs':[]});self.enroll(j)
        state=self.wait();self.assertEqual(state['status'],'waiting_review');packet=pathlib.Path(state['packet'])
        bad={'format':'migration-batch-review-v1','accepted':True,'reviewer':'reviewer','jobSha256':'0'*64,'step':'accept','packetSha256':runner.sha(packet)}
        with self.assertRaisesRegex(ValueError,'review_binding'):runner.approve(self.db,'pilot',bad)
        bad['jobSha256']=runner.sha(self.manifest);runner.approve(self.db,'pilot',bad);self.assertEqual(self.wait()['status'],'complete')
    def test_future_review_cannot_skip_predecessor_work(self):
        j=self.job();j['steps'].append({'id':'accept','kind':'review','inputs':[],'outputs':[]});self.enroll(j)
        with self.assertRaisesRegex(ValueError,'review_predecessor'):runner.approve(self.db,'pilot',{'step':'accept'})
    def test_killed_worker_does_not_relaunch_uncertain_command(self):
        self.job(delay='5');self.enroll();s=runner.advance(self.db,'pilot')
        # Kill process group, including command: production uncertainty stays explicit.
        time.sleep(.1);os.killpg(s['pid'],9);time.sleep(.1)
        s=runner.advance(self.db,'pilot');self.assertEqual(s['status'],'exception');self.assertEqual((self.root/'counter').read_text(),'1')

if __name__=='__main__':unittest.main()
