import pathlib,sys,tempfile,unittest
sys.path.insert(0,str(pathlib.Path(__file__).resolve().parents[2]/'scripts/migration_batch'))
from runner import atomic,ref
from verify import audit

class AuditTests(unittest.TestCase):
    def test_existing_failed_gate_or_changed_bytes_cannot_be_adopted(self):
        with tempfile.TemporaryDirectory()as folder:
            p=pathlib.Path(folder)/'transport.json';atomic(p,{'gates':[{'exitCode':0},{'exitCode':1}]})
            spec={'files':[ref(p)],'checks':[{'path':str(p),'assertions':[{'path':'gates.0.exitCode','equals':0},{'path':'gates.1.exitCode','equals':0}]}]}
            with self.assertRaisesRegex(ValueError,'output_assertion'):audit(spec)
            atomic(p,{'gates':[{'exitCode':0},{'exitCode':0}]})
            with self.assertRaisesRegex(ValueError,'input_changed'):audit(spec)
            spec['files']=[ref(p)];self.assertTrue(audit(spec)['verified'])
