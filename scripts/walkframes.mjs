// QA: record consecutive 60 Hz frames while the player walks forward (flicker measurement).
// node scripts/walkframes.mjs <outDir> <query> [warmFrames=30] [frames=6]
import { chromium } from 'playwright-core';
import { createServer } from 'node:http';
import { readFile, mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';

const [outArg, q, warmArg, nArg] = process.argv.slice(2);
const outDir = resolve(outArg);
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
await page.goto(`http://localhost:${port}/?play=1&ui=0&freeze=1&${q}`);
await page.waitForFunction(() => window.__ready === true, null, { timeout: 120000 });
await page.evaluate((n) => window.__step(n, 1), Number(warmArg ?? 30));
for (let i = 0; i < Number(nArg ?? 6); i++) {
  await page.evaluate(() => window.__step(1, 1));
  await page.screenshot({ path: `${outDir}/f${i}.png`, timeout: 120000 });
}
console.log('frames saved', outDir);
await browser.close();
server.close();
