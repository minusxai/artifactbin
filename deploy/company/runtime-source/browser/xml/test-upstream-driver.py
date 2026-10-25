"""Controlled lifecycle tests; no substitute for the hosted native suite."""
import os,subprocess,tempfile,unittest
from pathlib import Path
script=Path(__file__).with_name('run-upstream-tests.sh').resolve()
class Driver(unittest.TestCase):
 def test_build_before_execution_and_fail_closed(self):
  for scenario in ['pass','build_failure','zero_cases','catalog_failure']:
   with self.subTest(scenario=scenario),tempfile.TemporaryDirectory() as td:
    root=Path(td);build=root/'source/builddir/main';build.mkdir(parents=True);out=root/'out';out.mkdir();tools=root/'tools';tools.mkdir()
    (tools/'make').write_text('''#!/bin/sh
[ "$*" = '-j2 check' ] || exit 88
[ -L xmlconf ] || exit 89
[ "$SCENARIO" != build_failure ] || { echo fixture-build-failure; exit 17; }
cat > runxmlconf <<'END'
#!/bin/sh
if [ "$SCENARIO" = zero_cases ]; then echo 'Total 0 tests, 0 errors, 0 leaks'; else echo 'Total 2269 tests, 15 errors, 0 leaks'; echo '15 errors were expected'; fi
END
cat > testcatalog <<'END'
#!/bin/sh
[ "$SCENARIO" != catalog_failure ] || exit 19
END
chmod +x runxmlconf testcatalog
''');(tools/'make').chmod(0o755)
    env=dict(os.environ,PATH=str(tools)+os.pathsep+os.environ['PATH'],SCENARIO=scenario)
    result=subprocess.run(['sh',str(script),str(build),str(out)],env=env,capture_output=True,text=True)
    if scenario=='pass':self.assertEqual(result.returncode,0,result.stderr)
    elif scenario=='build_failure':self.assertEqual(result.returncode,17);self.assertIn('fixture-build-failure',result.stderr)
    elif scenario=='catalog_failure':self.assertEqual(result.returncode,19)
    else:self.assertNotEqual(result.returncode,0)
if __name__=='__main__':unittest.main()
