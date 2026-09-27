"""Snapshot the existing VM and Basis into an IDE-owned, platform-specific bundle."""
import argparse
import hashlib
import json
import os
from pathlib import Path
import shutil
import struct
from sml_sources import root, rune

parser = argparse.ArgumentParser()
parser.add_argument('--platform', choices=['linux', 'win32', 'darwin'], required=True)
parser.add_argument('--arch', choices=['x64', 'arm64'], default='x64')
args = parser.parse_args()
vm = Path(os.environ.get('RUNE_IDE_VM', str(rune / 'bin' / ('runevm.exe' if args.platform == 'win32' else 'runevm'))))
raw = vm.read_bytes()
if args.platform == 'linux':
    valid = raw[:4] == b'\x7fELF' and struct.unpack_from('<H', raw, 18)[0] == {'x64': 62, 'arm64': 183}[args.arch]
elif args.platform == 'win32':
    pe = struct.unpack_from('<I', raw, 60)[0] if raw[:2] == b'MZ' else 0
    valid = raw[pe:pe + 4] == b'PE\0\0' and struct.unpack_from('<H', raw, pe + 4)[0] == {'x64': 0x8664, 'arm64': 0xAA64}[args.arch]
else:
    valid = raw[:4] == b'\xcf\xfa\xed\xfe' and struct.unpack_from('<I', raw, 4)[0] == {'x64': 0x01000007, 'arm64': 0x0100000C}[args.arch]
if not valid:
    raise SystemExit(f'{vm} does not match {args.platform}-{args.arch}; supply a matching RUNE_IDE_VM')

basis_files = [rune / 'lib/basis/MANIFEST', *sorted((rune / 'lib/basis').glob('*.sml'))]
def basis_digest(directory):
    h = hashlib.sha256()
    for source in basis_files:
        relative = source.relative_to(rune)
        h.update(str(relative).encode()); h.update((directory / relative).read_bytes())
    return h.hexdigest()
info = json.loads((root / 'build/compiler-info.json').read_text())
if info.get('basisSha256') != basis_digest(rune):
    raise SystemExit('The compiler adapter and current Basis differ; run make compiler again')
parent = root / 'build/toolchains' / f'{args.platform}-{args.arch}'
parent.mkdir(parents=True, exist_ok=True)
staging = parent / 'toolchain.new'
if staging.exists():
    shutil.rmtree(staging)
(staging / 'bin').mkdir(parents=True)
(staging / 'lib').mkdir()
name = 'runevm.exe' if args.platform == 'win32' else 'runevm'
(staging / 'bin' / name).write_bytes(raw)
(staging / 'bin' / name).chmod(0o755)
shutil.copytree(rune / 'lib/basis', staging / 'lib/basis', ignore=shutil.ignore_patterns('.cm', '*.rbc'))
if basis_digest(staging) != info['basisSha256'] or basis_digest(rune) != info['basisSha256'] or vm.read_bytes() != raw:
    raise SystemExit('Toolchain inputs changed while staging; retry for a consistent snapshot')
files = {str(p.relative_to(staging)): hashlib.sha256(p.read_bytes()).hexdigest()
         for p in sorted(staging.rglob('*')) if p.is_file()}
for item in ['service.rbc', 'compiler.rbc', 'compiler-info.json']:
    files['../' + item] = hashlib.sha256((root / 'build' / item).read_bytes()).hexdigest()
(staging / 'bundle-info.json').write_text(json.dumps({
    'version': 1, 'platform': args.platform, 'arch': args.arch, 'compiler': info, 'files': files,
}, indent=2) + '\n')
output = parent / 'toolchain'
if output.exists():
    shutil.rmtree(output)
staging.rename(output)
print(f'Staged {args.platform}-{args.arch} toolchain in {output.relative_to(root)}')
