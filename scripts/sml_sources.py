"""Ordered SML inputs shared by the compiler builds and editor configuration."""
import os
from pathlib import Path

root = Path(__file__).resolve().parents[1]
rune = Path(os.environ.get('RUNE_ROOT', '/home/ruud/rune')).resolve()


def manifest(directory):
    return [directory / line.strip() for line in (directory / 'sources.txt').read_text().splitlines()
            if line.strip() and not line.lstrip().startswith('#')]


def service_sources():
    return [*manifest(root), root / 'src/sml/main.sml']


def compiler_sources():
    ordered = [rune / 'build/config.sml', root / 'src/sml/utf8.sml', root / 'src/sml/json.sml']
    for source in manifest(rune):
        ordered.append(source)
        if source == rune / 'src/util/error.sml':
            ordered.append(root / 'src/compiler/diagnostics.sml')
    return [*ordered, root / 'src/compiler/main.sml']
