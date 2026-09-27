import { win32 } from 'node:path';

// Rune uses POSIX-shaped /C:/... paths on Windows. Keep that wire identity;
// convert only when handing a path to Node's OS adapters.
export function nativePath(value: string, platform = process.platform): string {
  if (platform !== 'win32') return value;
  if (/^\/[A-Za-z]:\//.test(value)) return win32.normalize(value.slice(1));
  if (value.startsWith('//')) return win32.normalize(value);
  return value;
}
