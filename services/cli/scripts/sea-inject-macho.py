"""Build-only Intel Mac injection using current LIEF, avoiding postject's old Mach-O writer.

Algorithm: https://github.com/nodejs/node/blob/main/src/node_sea_bin.cc (InjectIntoMachO).
The caller strips first and signs the resulting executable afterwards.
"""
import sys
from pathlib import Path
import lief

executable, resource = map(Path, sys.argv[1:])
sentinel = b'NODE_SEA_FUSE_fce680ab2cc467b6e072b8b5df1996b2:0'
assert executable.read_bytes().count(sentinel) == 1, 'Expected exactly one unused SEA fuse'
blob = resource.read_bytes()
fat = lief.MachO.parse(str(executable))
assert fat is not None and len(fat) == 1, 'Expected a thin Mach-O executable'
for binary in fat:
    assert binary.get_segment('NODE_SEA') is None, 'SEA segment already exists'
    segment = lief.MachO.SegmentCommand('NODE_SEA')
    segment.max_protection = 1
    segment.init_protection = 1
    segment.add_section(lief.MachO.Section('__NODE_SEA_BLOB', list(blob)))
    binary.add(segment)
    if binary.has_code_signature:
        assert binary.remove_signature(), 'Could not remove old signature'
fat.write(str(executable))
written = executable.read_bytes()
assert written.count(sentinel) == 1, 'Injector changed the SEA fuse unexpectedly'
executable.write_bytes(written.replace(sentinel, sentinel[:-1] + b'1', 1))
verified = lief.MachO.parse(str(executable))
assert verified is not None and len(verified) == 1
for binary in verified:
    section = binary.get_segment('NODE_SEA').get_section('__NODE_SEA_BLOB')
    assert bytes(section.content) == blob, 'Embedded SEA bytes changed'
