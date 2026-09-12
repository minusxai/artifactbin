"""Build-only ELF injection preserving large dynamic symbol tables.

Algorithm: https://github.com/nodejs/node/blob/main/src/node_sea_bin.cc (InjectIntoELF).
Old postject/LIEF truncates symbol names for large GNU hash tables, breaking native addons.
"""
import sys
from collections import Counter
from pathlib import Path
import lief

def is_sea_note(note):
    # ELF owner names are byte strings; GNU build-attribute notes contain binary bytes.
    # Match only the ASCII resource prefix, as Node's C++ injector does.
    try:
        return note.name.startswith('NODE_SEA_BLOB')
    except UnicodeDecodeError as error:
        return error.object.startswith(b'NODE_SEA_BLOB')


def inject(executable, resource):
    sentinel = b'NODE_SEA_FUSE_fce680ab2cc467b6e072b8b5df1996b2:0'
    assert executable.read_bytes().count(sentinel) == 1, 'Expected exactly one unused SEA fuse'
    blob = resource.read_bytes()
    binary = lief.ELF.parse(str(executable))
    assert binary is not None, 'Expected an ELF executable'
    assert not any(is_sea_note(note) for note in binary.notes), 'SEA note already exists'
    symbols = Counter(symbol.name for symbol in binary.dynamic_symbols)
    note = lief.ELF.Note.create('NODE_SEA_BLOB', 0, list(blob), '.note.node.sea')
    assert note is not None, 'Could not create the SEA note'
    # Keep PT_LOAD pages disjoint on older Linux kernels, as Node's own injector does.
    if binary.header.file_type == lief.ELF.Header.FILE_TYPE.EXEC:
        assert binary.relocate_phdr_table(lief.ELF.Binary.PHDR_RELOC.BSS_END) != 0, 'Could not relocate program headers'
    binary.add(note)
    config = lief.ELF.Builder.config_t()
    config.notes = True
    config.dynamic_section = True
    binary.write(str(executable), config)
    written = executable.read_bytes()
    assert written.count(sentinel) == 1, 'Injector changed the SEA fuse unexpectedly'
    executable.write_bytes(written.replace(sentinel, sentinel[:-1] + b'1', 1))
    verified = lief.ELF.parse(str(executable))
    assert verified is not None
    assert Counter(symbol.name for symbol in verified.dynamic_symbols) == symbols, 'Injector changed dynamic symbol names'
    notes = [note for note in verified.notes if is_sea_note(note)]
    assert len(notes) == 1 and bytes(notes[0].description) == blob, 'Embedded SEA bytes changed'


if __name__ == '__main__':
    inject(*map(Path, sys.argv[1:]))
