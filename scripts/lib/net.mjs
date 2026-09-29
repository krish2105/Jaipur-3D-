// Small fetch helper with retries, disk caching (data-raw/, git-ignored) and clear blocked-domain errors.
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';

export const RAW_DIR = path.resolve('data-raw');

export class BlockedDomainError extends Error {
  constructor(host, detail) {
    super(`Network policy blocked ${host} (${detail}). Ask the owner to add "${host}" to the environment's allowed domains.`);
    this.host = host;
    this.blocked = true;
  }
}

export async function fetchBuffer(url, { cacheKey, retries = 3, timeoutMs = 60000, init = {} } = {}) {
  const cachePath = cacheKey ? path.join(RAW_DIR, cacheKey) : null;
  if (cachePath && existsSync(cachePath)) return readFile(cachePath);
  let lastErr;
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const ctl = new AbortController();
      const t = setTimeout(() => ctl.abort(), timeoutMs);
      const res = await fetch(url, { ...init, signal: ctl.signal });
      clearTimeout(t);
      if (res.status === 403 || res.status === 407) {
        const host = new URL(url).host;
        throw new BlockedDomainError(host, `HTTP ${res.status}`);
      }
      if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
      const buf = Buffer.from(await res.arrayBuffer());
      if (cachePath) {
        await mkdir(path.dirname(cachePath), { recursive: true });
        await writeFile(cachePath, buf);
      }
      return buf;
    } catch (e) {
      if (e.blocked) throw e;
      // Node's fetch surfaces proxy CONNECT refusals as "fetch failed" with cause ...403...
      const cause = String(e?.cause?.message || e?.cause || '');
      if (/403|407|tunnel/i.test(cause)) throw new BlockedDomainError(new URL(url).host, cause);
      lastErr = e;
      await new Promise((r) => setTimeout(r, 1000 * 2 ** attempt));
    }
  }
  throw lastErr;
}
