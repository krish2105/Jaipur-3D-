import { App } from './app.js';

const canvas = document.getElementById('c');
const bootMsg = document.getElementById('boot-msg');

async function boot() {
  const app = new App(canvas);
  window.__jaipur = app;
  try {
    await app.init((m) => { bootMsg.textContent = m + '…'; });
  } catch (e) {
    console.error(e);
    bootMsg.textContent = 'failed to start: ' + (e && e.message ? e.message : e);
    window.__jaipurError = String(e && e.stack ? e.stack : e);
    return;
  }
  app.start();
  document.getElementById('boot').classList.add('done');
  window.__jaipurReady = true;
}
boot();
