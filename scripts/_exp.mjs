import { openSession } from './lib/session.mjs';
const s = await openSession({ w: 960, h: 540, tier: 'medium' });
console.log(JSON.stringify(await s.shot({ t: 17.4, pos: [0, 160, 700], look: [0, 30, -1500], fov: 55, out: 'shots-tmp/p1_prod.png' })));
console.log(await s.page.evaluate(() => ({ notice: document.getElementById('notice').textContent, hidden: document.getElementById('notice').hidden, avail: window.__jaipur.city.available })));
console.log(s.logs.slice(0, 12).join('\n'));
await s.close(); process.exit(0);
