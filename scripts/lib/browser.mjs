// Shared Playwright launcher: headless Chromium with software WebGL2 (SwiftShader via ANGLE).
// The sandbox has no GPU, so everything is rendered at reduced resolution.
import { chromium } from 'playwright-core';
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import http from 'node:http';

export const CHROMIUM = process.env.CHROMIUM_PATH || '/opt/pw-browsers/chromium';

export const GL_ARGS = [
  '--use-gl=angle',
  '--use-angle=swiftshader',
  '--enable-unsafe-swiftshader',
  '--ignore-gpu-blocklist',
  '--enable-webgl',
  '--disable-gpu-sandbox',
  '--no-sandbox',
  '--disable-dev-shm-usage',
  '--autoplay-policy=no-user-gesture-required',
  '--hide-scrollbars',
  '--mute-audio',
  '--disable-background-networking',
  '--disable-component-update',
  '--no-first-run',
  '--disable-sync',
];

export async function launch(extraArgs = []) {
  if (!existsSync(CHROMIUM)) throw new Error(`Chromium not found at ${CHROMIUM}`);
  return chromium.launch({ executablePath: CHROMIUM, headless: true, args: [...GL_ARGS, ...extraArgs] });
}

/** Start `vite preview` on dist/ (build first) and resolve with {url, stop}. */
export async function startPreview(port = 4173) {
  const p = spawn(process.execPath, ['node_modules/vite/bin/vite.js', 'preview', '--host', '127.0.0.1', '--port', String(port), '--strictPort'], { stdio: ['ignore', 'ignore', 'ignore'], detached: true });
  p.unref();
  const url = `http://127.0.0.1:${port}/`;
  await new Promise((resolve, reject) => {
    const t0 = Date.now();
    const tick = () => {
      http.get(url, (res) => { res.resume(); resolve(); }).on('error', () => {
        if (Date.now() - t0 > 20000) reject(new Error('preview server did not start'));
        else setTimeout(tick, 250);
      });
    };
    tick();
  });
  return { url, stop: () => { try { process.kill(-p.pid, 'SIGTERM'); } catch { /* already gone */ } } };
}
