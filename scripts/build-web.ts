// Builds dist/: index.html (the whole app in one file, also used by Android), privacy and delete-account pages.
// API_BASE = the Worker address. With --live (npm run android:assets) it defaults to the live Worker;
// otherwise it is required in CI and defaults to the local `wrangler dev` address.
import { build } from 'esbuild';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const root = new URL('../', import.meta.url);
const read = (p: string) => readFileSync(new URL(p, root), 'utf8');
const LIVE_API = 'https://called-it.lodovikmirdita.workers.dev';
const fallback = process.argv.includes('--live') ? LIVE_API : process.env.CI ? '' : 'http://localhost:8787';
const apiBase = (process.env.API_BASE ?? '').replace(/\/+$/, '') || fallback;
if (!apiBase) throw new Error('Set API_BASE (repository variable) to the Worker address, e.g. https://called-it.<name>.workers.dev');
const webUrl = process.env.WEB_URL ?? 'https://albmarketsautopilot-lab.github.io/cit/';

const privacy = read('public/privacy.html').split('<main>')[1].split('</main>')[0];
const result = await build({
  entryPoints: [fileURLToPath(new URL('web/src/main.ts', root))],
  bundle: true,
  format: 'iife',
  target: 'es2020',
  minify: true,
  write: false,
  define: {
    API_BASE: JSON.stringify(apiBase),
    WEB_URL: JSON.stringify(webUrl),
    PRIVACY_HTML: JSON.stringify(privacy),
  },
});
const js = result.outputFiles[0].text.replace(/<\/script/gi, '<\\/script');
const html = read('web/index.html')
  .replace('/*STYLE*/', () => read('web/style.css'))
  .replace('/*SCRIPT*/', () => js);

mkdirSync(new URL('dist/', root), { recursive: true });
writeFileSync(new URL('dist/index.html', root), html);
writeFileSync(new URL('dist/privacy.html', root), read('public/privacy.html'));
writeFileSync(new URL('dist/delete-account.html', root), read('public/delete-account.html').replace('/*API_BASE*/', apiBase));
console.log(`dist/index.html ${(html.length / 1024).toFixed(1)} KB, API ${apiBase}`);
