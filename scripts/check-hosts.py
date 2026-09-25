"""Build and exercise the same SML protocol on the installed host compilers."""
import json
import os
from pathlib import Path
import subprocess

root = Path(__file__).resolve().parents[1]
hosts = Path(os.environ.get('RUNE_HOSTS', str(Path.home() / '.local/rune-hosts')))
build = root / 'build/hosts'
build.mkdir(parents=True, exist_ok=True)
sources = [root / s for s in (root / 'sources.txt').read_text().splitlines() if s and not s.startswith('#')]
def run(args, **kwargs):
    subprocess.run(list(map(str, args)), cwd=root, check=True, **kwargs)
def exercise(command):
    env = dict(os.environ, SERVICE_COMMAND=json.dumps(list(map(str, command))))
    run(['node', '--test', 'tests/service.test.cjs'], env=env)

mlb = build / 'service.mlb'
mlb.write_text('$(SML_LIB)/basis/basis.mlb\n' + '\n'.join(map(str, sources)) + '\n' + str(root / 'src/sml/main.sml') + '\n')
run([hosts / 'mlton/bin/mlton', '-output', build / 'service-mlton', mlb])
exercise([build / 'service-mlton'])

poly = build / 'service-polyml.sml'
poly.write_text('\n'.join(f'use {json.dumps(str(p))};' for p in sources) + '\nfun main () = IdeService.main ();\n')
run([hosts / 'polyml/bin/polyc', '-o', build / 'service-polyml', poly])
exercise([build / 'service-polyml'])

entry = build / 'host-main.sml'
entry.write_text('structure HostMain = struct fun main (_ : string, _ : string list) = (IdeService.main (); OS.Process.success) end\n')
cm = build / 'service.cm'
cm.write_text('Group is\n$/basis.cm\n' + '\n'.join(map(str, sources)) + '\n' + str(entry) + '\n')
for host in ['smlnj', 'smlnj32']:
    output = build / ('service-' + host)
    run([hosts / host / 'bin/ml-build', cm, 'HostMain.main', output])
    heaps = list(build.glob('service-' + host + '.*-linux'))
    if len(heaps) != 1:
        raise RuntimeError(f'Expected one heap image for {host}: {heaps}')
    exercise([hosts / host / 'bin/sml', '@SMLload=' + str(heaps[0])])
