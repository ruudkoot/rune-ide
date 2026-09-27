"""Create a private portable archive and its checksum, without publishing it."""
import hashlib
from pathlib import Path
import shutil
import subprocess
import sys

package = Path(sys.argv[1]).resolve()
subprocess.run([sys.executable, str(Path(__file__).with_name('verify-package.py')), str(package)], check=True)
format = 'zip' if '-win32-' in package.name else 'gztar'
archive = Path(shutil.make_archive(str(package), format, root_dir=package.parent, base_dir=package.name))
checksum = hashlib.sha256(archive.read_bytes()).hexdigest()
archive.with_name(archive.name + '.sha256').write_text(checksum + '  ' + archive.name + '\n')
print(archive)
