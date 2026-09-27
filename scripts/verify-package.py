"""Verify packaged resources without consulting a Rune installation."""
import hashlib
import json
from pathlib import Path
import sys

package = Path(sys.argv[1]).resolve()
resources = package / 'resources'
if package.suffix == '.app':
    resources = package / 'Contents/Resources'
bundle = resources / 'toolchain'
info = json.loads((bundle / 'bundle-info.json').read_text())
if info['version'] != 1:
    raise SystemExit('Unsupported bundle manifest')
for name, expected in info['files'].items():
    file = (bundle / name).resolve()
    if not file.is_relative_to(resources):
        raise SystemExit(f'Invalid manifest path: {name}')
    if hashlib.sha256(file.read_bytes()).hexdigest() != expected:
        raise SystemExit(f'Package resource differs: {name}')
print(f"Verified {len(info['files'])} resources for {info['platform']}-{info['arch']}")
