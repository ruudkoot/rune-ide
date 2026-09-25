"""Build only into rune-ide; RUNE_ROOT is a read-only toolchain input."""
import os
from pathlib import Path
import subprocess

root = Path(__file__).resolve().parents[1]
rune = Path(os.environ.get('RUNE_ROOT', '/home/ruud/rune')).resolve()
build = root / 'build'
build.mkdir(exist_ok=True)
sources = [root / line.strip() for line in (root / 'sources.txt').read_text().splitlines()
           if line.strip() and not line.startswith('#')]
subprocess.run([str(rune / 'bin/rune'), '-o', str(build / 'service.rbc'),
                *map(str, sources), str(root / 'src/sml/main.sml')], cwd=root, check=True)
print('Built build/service.rbc with Rune')
