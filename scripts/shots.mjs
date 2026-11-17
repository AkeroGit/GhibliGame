// Renders the built game in headless Chromium and saves stills for review.
// Usage: npm run build && node scripts/shots.mjs [outDir]
import { chromium } from 'playwright-core';
import { createServer } from 'node:http';
import { readFile, mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';

const outDir = resolve(process.argv[2] ?? 'docs/shots');
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

const shots = [['dawn', 0.27], ['noon', 0.5], ['dusk', 0.74], ['night', 0.95]];
for (const [name, day] of shots) {
  await page.goto(`http://localhost:${port}/?day=${day}&t=37&freeze=1`);
  await page.waitForFunction(() => window.__ready === true, null, { timeout: 30000 });
  await page.waitForTimeout(400);
  await page.screenshot({ path: `${outDir}/${name}.png` });
  console.log('saved', name);
}
await browser.close();
server.close();
if (errors.length) { console.log('console issues:\n' + [...new Set(errors)].join('\n')); process.exitCode = 1; }
