import { test, expect } from '@playwright/test';
import http from 'http';

test('compare main thread, worker, and shared worker fetch interception', async ({ browser }) => {
  // Spin up a dummy server on port 3000
  const server = http.createServer((req, res) => {
    res.writeHead(200, {
      'Content-Type': 'text/plain',
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Headers': '*',
      'Access-Control-Allow-Methods': '*'
    });
    res.end('SERVED_BY_REAL_SERVER');
  });

  await new Promise<void>((resolve) => {
    server.listen(3000, resolve);
  });

  const context = await browser.newContext();

  // Route interception logging
  await context.route('**/*', async (route) => {
    const req = route.request();
    console.log('PLAYWRIGHT SAW ROUTE:', req.method(), req.url());

    if (req.url() === 'http://localhost:3000/api/snapshot') {
      console.log('PLAYWRIGHT MOCKING SNAPSHOT!');
      return route.fulfill({
        status: 200,
        contentType: 'text/plain',
        body: 'MOCKED_BY_PLAYWRIGHT',
      });
    }

    return route.continue();
  });

  const page = await context.newPage();

  // Forward page console logs to terminal
  page.on('console', msg => {
    console.log('PAGE CONSOLE:', msg.text());
  });

  page.on('pageerror', err => {
    console.log('PAGE ERROR:', err.message);
  });

  page.on('error', err => {
    console.log('PAGE CRASH ERROR:', err.message);
  });

  console.log('Navigating to local serve page...');
  await page.goto('http://localhost:8080');

  console.log('\n--- Clicking Main Fetch ---');
  await page.getByRole('button', { name: 'Main fetch' }).click();
  await expect(page.locator('#out')).toContainText('main fetch result: MOCKED_BY_PLAYWRIGHT');

  console.log('\n--- Clicking WebWorker Fetch ---');
  await page.getByRole('button', { name: 'WebWorker fetch' }).click();
  await page.waitForTimeout(1500);

  console.log('\n--- Clicking SharedWorker Fetch ---');
  await page.getByRole('button', { name: 'SharedWorker fetch' }).click();
  await page.waitForTimeout(2000);

  console.log('\n--- Final Output Content ---');
  const outText = await page.locator('#out').innerText();
  console.log(outText);
  console.log('----------------------------\n');

  console.log('Keeping browser open. Close/stop the command execution when you are done.');
  await page.pause();

  // Clean up server
  await new Promise<void>((resolve) => {
    server.close(() => resolve());
  });
});
