import hashlib,json,pathlib,sys,tempfile,unittest
sys.path.insert(0,str(pathlib.Path(__file__).resolve().parents[2]/'scripts/migration_batch'))
import completion
from runner import sha,ref,atomic

class CompletionTests(unittest.TestCase):
    def setUp(self):
        self.tmp=tempfile.TemporaryDirectory();self.r=pathlib.Path(self.tmp.name);self.q=self.r/'queue';self.q.mkdir();(self.q/'receipts').mkdir()
        atomic(self.q/'normal-reader.json',{'complete':True,'exact':True,'expectedSourceId':'item','expectedVersion':1,'internalTokens':{'allRevoked':True},'accessAndComments':{k:True for k in ['visibilityExact','linkRoleExact','sharesExact','guestPolicyExact','commentsExact']},'rows':[{'assets':['a']}],'datasets':[],'datasetObjects':[]})
        for n in ['head-1.json','publication-1.json']:atomic(self.q/'receipts'/n,{'ok':True})
        atomic(self.q/'acceptance-scope.private.json',{'ok':True});atomic(self.r/'comparison.json',{'passed':True});atomic(self.q/'comparison.json',{'status':'verified','comparisonPath':str(self.r/'comparison.json'),'comparisonSha256':sha(self.r/'comparison.json')})
        self.p=self.r/'accepted1-completion.private.json';atomic(self.p,{'latestHeadsAccepted':1,'knownAssetReferencesExcludingOriginalCanary':3});self.active=self.r/'ACTIVE.json';atomic(self.active,{'latestHeadsAccepted':1,'latestCompletionReceipt':str(self.p),'latestCompletionReceiptSha256':sha(self.p),'unrelated':'preserved'})
        self.options={'source':'item','version':1,'queue':str(self.q),'prior':ref(self.p),'nextCount':2,'active':str(self.active)}
    def tearDown(self):self.tmp.cleanup()
    def test_crash_after_receipt_resumes_alias_promotion_once(self):
        def crash():raise RuntimeError('simulated process loss')
        with self.assertRaisesRegex(RuntimeError,'simulated'):completion.record(self.options,after_receipt=crash)
        receipt=self.r/'accepted2-completion.private.json';before=receipt.read_bytes();self.assertEqual(json.loads(self.active.read_text())['latestHeadsAccepted'],1)
        out=completion.record(self.options);self.assertEqual(out['accepted'],2);self.assertEqual(receipt.read_bytes(),before)
        self.assertEqual(completion.record(self.options),out);a=json.loads(self.active.read_text());self.assertEqual(a['acceptedLatestHeads'],2);self.assertEqual(a['remaining'],391);self.assertEqual(a['unrelated'],'preserved')
    def test_never_counts_apply_without_readback_and_revocation(self):
        r=json.loads((self.q/'normal-reader.json').read_text());r['internalTokens']['allRevoked']=False;atomic(self.q/'normal-reader.json',r)
        with self.assertRaisesRegex(ValueError,'reader_preservation'):completion.record(self.options)
        self.assertFalse((self.r/'accepted2-completion.private.json').exists())
    def test_conflicting_existing_receipt_is_not_replaced(self):
        atomic(self.r/'accepted2-completion.private.json',{'latestHeadsAccepted':2})
        with self.assertRaisesRegex(ValueError,'receipt_collision'):completion.record(self.options)
    def test_wrong_active_chain_creates_no_completion(self):
        a=json.loads(self.active.read_text());a['latestCompletionReceiptSha256']='0'*64;atomic(self.active,a)
        with self.assertRaisesRegex(ValueError,'active_chain'):completion.record(self.options)
        self.assertFalse((self.r/'accepted2-completion.private.json').exists())
    def test_prepare_binds_current_verified_predecessor_and_rejects_alias_drift(self):
        a=json.loads(self.active.read_text())
        for k in ['acceptedLatestHeads','latestVerifiedAccepted','authoritativeAcceptedLatest','latestVerifiedAcceptedHeads']:a[k]=1
        atomic(self.active,a);request=completion.prepare('item',1,str(self.q),str(self.active));self.assertEqual(request['nextCount'],2);self.assertEqual(request['prior']['sha256'],sha(self.p))
        a['latestVerifiedAcceptedHeads']=0;atomic(self.active,a)
        with self.assertRaisesRegex(ValueError,'active_aliases_inconsistent'):completion.prepare('item',1,str(self.q),str(self.active))
