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
  ['golden', 'ui=0&day=0.69&cam=cover'],
  ['goldenair', 'ui=0&day=0.69&cam=aerial'],
  ['noon', 'ui=0&day=0.5&cam=house'],
  ['dawn', 'ui=0&day=0.27&cam=house'],
  ['dusk', 'ui=0&day=0.745&cam=sea'],
  ['night', 'ui=0&day=0.95&cam=house'],
  ['tree', 'ui=0&day=0.42&cam=tree'],
  ['treelow', 'ui=0&day=0.42&cam=treelow'],
  ['aerial', 'ui=0&day=0.45&cam=aerial'],
  ['roof', 'ui=0&day=0.45&cam=roof'],
  ['porch', 'ui=0&day=0.6&cam=porch'],
  ['corner', 'ui=0&day=0.45&cam=corner'],
  ['cornerlow', 'ui=0&day=0.45&cam=cornerlow'],
  ['tip', 'ui=0&day=0.45&cam=tip'],
  ['char', 'ui=0&day=0.62&cam=char'],
  ['face', 'ui=0&day=0.62&cam=char&cd=0.9&ch=1.45&cl=1.42'],
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
