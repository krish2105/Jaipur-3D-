   # Jaipur 3D: project rules

   - Static Vite site; `npm run build` outputs `dist/`. Pushes to main auto-deploy on Vercel. Never use Vercel credentials or CLI.
   - Cloud sandbox has no GPU: verify with Playwright + software rendering at low resolution, WebGL2 only. Fps numbers from the sandbox are meaningless; use the in-app performance overlay and budget scripts instead.
   - Network is allow-listed. If a domain is blocked, stop that step and tell the user which domain to allow. Never fake data or scrape map services.
   - Work in phases; commit and push after every phase; keep PROGRESS.md updated (done, next, decisions, known shortfalls).
   - Keep baked data under about 30 MB total, chunked by tile. No big binaries in git.
   - Data: OpenStreetMap via Overpass, baked into static chunks at build time. Credit "OpenStreetMap contributors" in the README.
