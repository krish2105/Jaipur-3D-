// Shared Playwright launcher.
//  * cloud sandbox (no GPU): headless Chromium with software WebGL2 (SwiftShader via ANGLE), reduced resolution
//  * developer machine (macOS): the installed Google Chrome with the real GPU through ANGLE/Metal
// Override with CHROMIUM_PATH=/path/to/chrome and GL_MODE=gpu|software.
import { chromium } from 'playwright-core';
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import http from 'node:http';

const CANDIDATES = [
  process.env.CHROMIUM_PATH,
  '/opt/pw-browsers/chromium', // cloud sandbox
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/usr/bin/google-chrome',
  '/usr/bin/chromium',
].filter(Boolean);

export const CHROMIUM = CANDIDATES.find((p) => existsSync(p)) || CANDIDATES[0];

/** 'gpu' on a Mac (real hardware) unless forced, otherwise software rendering. */
export const GL_MODE = process.env.GL_MODE || (process.platform === 'darwin' ? 'gpu' : 'software');

const COMMON_ARGS = [
  '--ignore-gpu-blocklist',
  '--enable-webgl',
  '--autoplay-policy=no-user-gesture-required',
  '--hide-scrollbars',
  '--mute-audio',
  '--disable-background-networking',
  '--disable-component-update',
  '--no-first-run',
  '--disable-sync',
  // headless Chrome throttles background/occluded pages; the harness drives frames itself
  '--disable-renderer-backgrounding',
  '--disable-background-timer-throttling',
];

export const GL_ARGS = GL_MODE === 'gpu'
  ? [...COMMON_ARGS, '--use-angle=metal', '--enable-gpu-rasterization', '--enable-unsafe-webgpu=false']
  : [
      ...COMMON_ARGS,
      '--use-gl=angle',
      '--use-angle=swiftshader',
      '--enable-unsafe-swiftshader',
      '--disable-gpu-sandbox',
      '--no-sandbox',
      '--disable-dev-shm-usage',
    ];

export async function launch(extraArgs = []) {
  if (!existsSync(CHROMIUM)) throw new Error(`Chromium/Chrome not found at ${CHROMIUM}. Set CHROMIUM_PATH.`);
  return chromium.launch({ executablePath: CHROMIUM, headless: true, args: [...GL_ARGS, ...extraArgs] });
}

/** Start `vite preview` on dist/ (build first) and resolve with {url, stop}. */
export async function startPreview(port = 4173, dir = process.env.PREVIEW_DIR || 'dist') {
  const p = spawn(process.execPath, ['node_modules/vite/bin/vite.js', 'preview', '--outDir', dir, '--host', '127.0.0.1', '--port', String(port), '--strictPort'], { stdio: ['ignore', 'ignore', 'ignore'], detached: true });
  p.unref();
  const url = `http://127.0.0.1:${port}/`;
  let stopped = false;
  p.on('exit', (code) => { if (code && !stopped) console.error(`preview server exited with ${code} (port ${port} busy?)`); });
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
  return { url, stop: () => { stopped = true; try { process.kill(-p.pid, 'SIGTERM'); } catch { /* already gone */ } } };
}
