"""Build only into rune-ide; RUNE_ROOT is a read-only toolchain input."""
import subprocess
from sml_sources import root, rune, service_sources

build = root / 'build'
build.mkdir(exist_ok=True)
subprocess.run([str(rune / 'bin/rune'), '-o', str(build / 'service.rbc'),
                *map(str, service_sources())], cwd=root, check=True)
print('Built build/service.rbc with Rune')
