"""Compile a diagnostic adapter against Rune sources, with all output here."""
import hashlib
import json
from pathlib import Path
import subprocess
from sml_sources import root, rune, manifest, compiler_sources

build = root / 'build'
build.mkdir(exist_ok=True)
sources = manifest(rune)
basis_inputs = [rune / 'lib/basis/MANIFEST', *sorted((rune / 'lib/basis').glob('*.sml'))]
inputs = [rune / 'build/config.sml', *sources, *basis_inputs, rune / 'bin/rune.rbc']
def digest():
    h = hashlib.sha256()
    for source in inputs:
        h.update(str(source.relative_to(rune)).encode()); h.update(source.read_bytes())
    return h.hexdigest()
identity = digest()
basis_hash = hashlib.sha256()
for source in basis_inputs:
    basis_hash.update(str(source.relative_to(rune)).encode()); basis_hash.update(source.read_bytes())
metadata = build / 'compiler-info.json'
output = build / 'compiler.rbc'
adapter_files = [Path(__file__), root / 'scripts/sml_sources.py', root / 'src/sml/utf8.sml', root / 'src/sml/json.sml',
                 root / 'src/compiler/diagnostics.sml', root / 'src/compiler/main.sml']
adapter_hash = hashlib.sha256(b''.join(p.read_bytes() for p in adapter_files)).hexdigest()
if output.exists() and metadata.exists():
    cached = json.loads(metadata.read_text())
    if cached.get('sourcesSha256') == identity and cached.get('adapterSha256') == adapter_hash:
        print('Compiler adapter is current'); raise SystemExit(0)
ordered = compiler_sources()
temporary = build / 'compiler.new.rbc'
subprocess.run([str(rune / 'bin/rune'), '-o', str(temporary), *map(str, ordered)], cwd=root, check=True)
if digest() != identity:
    temporary.unlink(missing_ok=True)
    raise RuntimeError('Rune sources changed during the build; retry for a consistent adapter')
temporary.replace(output)
head = subprocess.check_output(['git', '-C', str(rune), 'rev-parse', 'HEAD'], text=True).strip()
metadata.write_text(json.dumps({'protocol': 1, 'runeHead': head, 'sourcesSha256': identity,
                               'adapterSha256': adapter_hash, 'basisSha256': basis_hash.hexdigest()}, indent=2) + '\n')
print('Built build/compiler.rbc with the existing self-hosted Rune compiler')
