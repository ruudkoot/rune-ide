"""Run native, hidden Windows acceptance from WSL; remove only our temporary copy."""
from pathlib import Path
import shutil
import subprocess
import tempfile

root = Path(__file__).resolve().parents[1]
package = root / 'out/Rune-win32-x64'
report = root / 'test-results-windows/acceptance.json'
report.unlink(missing_ok=True)
subprocess.run(['python3', str(root / 'scripts/verify-package.py'), str(package)], check=True)
local = subprocess.check_output(['powershell.exe', '-NoProfile', '-NonInteractive', '-Command', '[Environment]::GetFolderPath("LocalApplicationData")'], text=True).strip()
local = Path(subprocess.check_output(['wslpath', '-u', local], text=True).strip())
work = Path(tempfile.mkdtemp(prefix='RuneIDE-test-', dir=local / 'Temp'))
def windows(path):
    return subprocess.check_output(['wslpath', '-w', str(path)], text=True).strip()
try:
    target = work / 'Rune portable'
    shutil.copytree(package, target)
    result = subprocess.run(['powershell.exe', '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', windows(root / 'scripts/test-windows.ps1'), '-Package', windows(target), '-Project', windows(root)], timeout=600)
    if result.returncode == 0 and not report.is_file():
        raise SystemExit('Windows driver did not produce a fresh acceptance report')
    raise SystemExit(result.returncode)
finally:
    shutil.rmtree(work)
