import sys
from pathlib import Path

def exports(path):
    return {tuple(line.split()[-2:]) for line in Path(path).read_text().splitlines()
            if len(line.split()) >= 7 and '*UND*' not in line and '*ABS*' not in line}

before, after = map(exports, sys.argv[1:])
assert before, 'No original exported symbols found'
assert not before - after, f'Missing versioned symbols: {sorted(before - after)}'
print(f'Preserved {len(before)} original versioned exports')
