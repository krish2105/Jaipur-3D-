// Enforces the repo data budget: baked data (public/data) under ~30 MB total, no oversized single chunk,
// no stray binaries elsewhere in git.
import { readdir, stat } from 'node:fs/promises';
import { execSync } from 'node:child_process';
import path from 'node:path';

const LIMIT_TOTAL = 30 * 1024 * 1024;
const LIMIT_FILE = 4 * 1024 * 1024;
async function walk(dir, out = []) {
  for (const e of await readdir(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) await walk(p, out);
    else out.push([p, (await stat(p)).size]);
  }
  return out;
}
const files = await walk('public/data').catch(() => []);
const total = files.reduce((s, [, n]) => s + n, 0);
let bad = 0;
console.log(`public/data: ${files.length} files, ${(total / 1e6).toFixed(2)} MB (limit ${(LIMIT_TOTAL / 1e6).toFixed(0)} MB)`);
if (total > LIMIT_TOTAL) { console.error('FAIL: total data budget exceeded'); bad++; }
for (const [f, n] of files) if (n > LIMIT_FILE) { console.error(`FAIL: ${f} is ${(n / 1e6).toFixed(2)} MB (> ${LIMIT_FILE / 1e6} MB chunk limit)`); bad++; }
// large tracked files anywhere
const tracked = execSync('git ls-files -z', { encoding: 'utf8' }).split('\0').filter(Boolean);
for (const f of tracked) {
  try { const s = (await stat(f)).size; if (s > 5 * 1024 * 1024 && !f.startsWith('public/data/')) { console.error(`FAIL: large tracked file ${f} (${(s / 1e6).toFixed(1)} MB)`); bad++; } } catch { /* deleted */ }
}
process.exit(bad ? 1 : 0);
