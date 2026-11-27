// Ad-hoc QA renders: node scripts/qshots.mjs <outDir> name=querystring [name=query ...]
// e.g. node scripts/qshots.mjs /tmp/q east='ui=0&day=0.62&cp=35,2.4,41,27.6,1,41.3'
import { chromium } from 'playwright-core';
import { createServer } from 'node:http';
import { readFile, mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';

const outDir = resolve(process.argv[2]);
const shots = process.argv.slice(3).map((a) => { const i = a.indexOf('='); return [a.slice(0, i), a.slice(i + 1)]; });
await mkdir(outDir, { recursive: true });
const html = await readFile(resolve(process.env.DIST ?? 'dist', 'index.html'));
const server = createServer((_, res) => { res.writeHead(200, { 'content-type': 'text/html' }); res.end(html); });
await new Promise((r) => server.listen(0, r));
const port = server.address().port;
const browser = await chromium.launch({
  executablePath: process.env.AGENT_BROWSER_EXECUTABLE_PATH,
  args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'],
});
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
const errors = [];
page.on('pageerror', (e) => errors.push(String(e)));
for (const [name, q] of shots) {
  const t0 = Date.now();
  const extra = /(^|&)t=/.test(q) ? '' : '&t=37';
  await page.goto(`http://localhost:${port}/?${q}${extra}&freeze=1${/(^|&)q=/.test(q) ? '' : '&q=med'}`);
  await page.waitForFunction(() => window.__ready === true, null, { timeout: 120000 });
  await page.waitForTimeout(300);
  await page.screenshot({ path: `${outDir}/${name}.png` });
  console.log('saved', name, `${((Date.now() - t0) / 1000).toFixed(1)}s`);
}
await browser.close();
server.close();
if (errors.length) { console.log('page errors:\n' + [...new Set(errors)].slice(0, 8).join('\n')); process.exitCode = 1; }
