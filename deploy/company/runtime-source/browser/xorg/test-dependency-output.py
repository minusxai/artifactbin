"""Dependency-output contract controls; no Docker or complete package import."""
import ast
from pathlib import Path
import re
import subprocess
import unittest
from unittest.mock import Mock

source = Path(__file__).with_name('package.py')
node = next(n for n in ast.parse(source.read_text()).body
            if isinstance(n, ast.FunctionDef) and n.name == 'derive_dependencies')

class DependencyOutput(unittest.TestCase):
    def call(self, output, dynamics=('',), error=None):
        tool = Mock()
        tool.check_output.side_effect = ([error] if error else [output] + list(dynamics))
        namespace = {'subprocess': tool, 're': re}
        exec(compile(ast.Module(body=[node], type_ignores=[]), str(source), 'exec'), namespace)
        return namespace['derive_dependencies'](['dpkg-shlibdeps', '-O'], ['shim.so'], Path('/metadata'))

    def test_no_needed_no_output(self):
        self.assertEqual(self.call(''), '')

    def test_explicit_empty_without_needed(self):
        self.assertEqual(self.call('shlibs:Depends=\n'), '')

    def test_real_dependencies_preserved(self):
        self.assertEqual(self.call('shlibs:Depends=libc6 (>= 2.34), libX11-6\n'), 'libc6 (>= 2.34), libX11-6')

    def test_needed_cannot_have_missing_or_empty_result(self):
        for output in ('', 'shlibs:Depends=\n'):
            with self.subTest(output=output), self.assertRaisesRegex(AssertionError, 'Missing derived'):
                self.call(output, ('0x0000000000000001 (NEEDED) Shared library: [libc.so.6]',))

    def test_dependency_tool_failure_fatal(self):
        with self.assertRaises(subprocess.CalledProcessError):
            self.call('', error=subprocess.CalledProcessError(2, 'dpkg-shlibdeps'))

    def test_dynamic_inspection_failure_fatal(self):
        with self.assertRaises(subprocess.CalledProcessError):
            self.call('', (subprocess.CalledProcessError(1, 'readelf'),))

    def test_unexpected_or_duplicate_output_fatal(self):
        for output in ('unexpected output', 'shlibs:Depends=a\nshlibs:Depends=b\n'):
            with self.subTest(output=output), self.assertRaises(AssertionError):
                self.call(output)

if __name__ == '__main__':
    unittest.main()
