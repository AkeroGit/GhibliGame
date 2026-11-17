// Renders the built game in headless Chromium and saves stills for review.
// Usage: npm run build && node scripts/shots.mjs [outDir] [only-name]
import { chromium } from 'playwright-core';
import { createServer } from 'node:http';
import { readFile, mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';

const outDir = resolve(process.argv[2] ?? 'docs/shots');
const only = process.argv[3];
await mkdir(outDir, { recursive: true });
const html = await readFile(resolve('dist/index.html'));
const server = createServer((_, res) => { res.writeHead(200, { 'content-type': 'text/html' }); res.end(html); });
await new Promise((r) => server.listen(0, r));
const port = server.address().port;

const browser = await chromium.launch({
  executablePath: process.env.AGENT_BROWSER_EXECUTABLE_PATH,
  args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'],
});
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
const errors = [];
page.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') errors.push(m.text()); });
page.on('pageerror', (e) => errors.push(String(e)));

const shots = [
  ['noon', 'day=0.5&cam=house'],
  ['dawn', 'day=0.27&cam=house'],
  ['dusk', 'day=0.745&cam=sea'],
  ['night', 'day=0.95&cam=house'],
  ['tree', 'day=0.42&cam=tree'],
  ['aerial', 'day=0.45&cam=aerial'],
  ['roof', 'day=0.45&cam=roof'],
  ['porch', 'day=0.6&cam=porch'],
  ['corner', 'day=0.45&cam=corner'],
  ['cornerlow', 'day=0.45&cam=cornerlow'],
].filter(([n]) => !only || only.split(',').includes(n));

for (const [name, q] of shots) {
  const t0 = Date.now();
  await page.goto(`http://localhost:${port}/?${q}&t=37&freeze=1&q=med`);
  await page.waitForFunction(() => window.__ready === true, null, { timeout: 120000 });
  await page.waitForTimeout(300);
  await page.screenshot({ path: `${outDir}/${name}.png` });
  console.log('saved', name, `${((Date.now() - t0) / 1000).toFixed(1)}s`);
}
await browser.close();
server.close();
if (errors.length) { console.log('console issues:\n' + [...new Set(errors)].slice(0, 12).join('\n')); process.exitCode = 1; }
