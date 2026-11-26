// Smoke-tests the playable build: loads ?play=1, walks, looks, and checks for runtime errors.
import { chromium } from 'playwright-core';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const html = await readFile(resolve('dist/index.html'));
const server = createServer((_, res) => { res.writeHead(200, { 'content-type': 'text/html' }); res.end(html); });
await new Promise((r) => server.listen(0, r));
const port = server.address().port;
const browser = await chromium.launch({ executablePath: process.env.AGENT_BROWSER_EXECUTABLE_PATH, args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
const errors = [];
page.on('pageerror', (e) => errors.push(String(e)));
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
await page.goto(`http://localhost:${port}/?play=1&day=0.5&q=low`);
await page.waitForFunction(() => window.__ready === true, null, { timeout: 120000 });
await page.keyboard.down('KeyW');
await page.waitForTimeout(1200);
await page.keyboard.up('KeyW');
await page.mouse.click(640, 360);
await page.mouse.move(720, 360, { steps: 4 });
await page.waitForTimeout(600);
await page.keyboard.press('KeyR');
await page.waitForTimeout(400);
await page.screenshot({ path: 'docs/shots/playtest.png', timeout: 120000 });
await browser.close();
server.close();
if (errors.length) { console.error(errors.join('\n')); process.exitCode = 1; }
else console.log('playtest: PASS (load, walk, pointer-look, reset-camera)');
