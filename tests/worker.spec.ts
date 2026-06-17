import { test, expect } from '@playwright/test';
import http from 'http';

let server: http.Server;

test.beforeAll(async () => {
  server = http.createServer((req, res) => {
    res.writeHead(200, {
      'Content-Type': 'text/plain',
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Headers': '*',
      'Access-Control-Allow-Methods': '*'
    });
    if (req.method === 'OPTIONS') {
      res.end();
      return;
    }
    // Return exactly which endpoint was hit
    res.end(`[REAL_SERVER] ${req.method} ${req.url}`);
  });

  await new Promise<void>((resolve) => {
    server.listen(3000, resolve);
  });
});

test.afterAll(async () => {
  await new Promise<void>((resolve) => {
    server.close(() => resolve());
  });
});

test('Selective Network Mocking using Route Fulfill and Script Patching', async ({ browser }) => {
  const context = await browser.newContext();

  // Inject the Blob Proxy logic as a specialized constructor
  await context.addInitScript(() => {
    // @ts-ignore
    window.BlobProxiedSharedWorker = function(workerUrl: string) {
      const channel = new MessageChannel();
      
      // Fetch the script. Since Playwright is intercepting **/shared-worker.js,
      // this fetch will naturally return the intercepted, monkey-patched script!
      fetch(workerUrl)
        .then(res => res.text())
        .then(scriptText => {
          // Wrap the intercepted script into a Blob to bypass Chrome's opaque origin sandbox!
          const blob = new Blob([scriptText], { type: 'application/javascript' });
          const blobUrl = URL.createObjectURL(blob);
          
          // Boot the worker using the Blob URL!
          const realWorker = new window.SharedWorker(blobUrl);
          
          realWorker.port.onmessage = (e) => channel.port1.postMessage(e.data);
          channel.port1.onmessage = (e) => realWorker.port.postMessage(e.data);
          
          realWorker.port.start();
        });
        
      return { port: channel.port2 };
    };
  });

  await context.route('**/*', async (route) => {
    const req = route.request();
    const url = req.url();

    console.log('PLAYWRIGHT SAW ROUTE:', req.method(), url);

    // 1. Intercept the SharedWorker script to inject a fetch patch
    if (url.endsWith('/shared-worker.js')) {
      const response = await route.fetch();
      const originalScript = await response.text();

      // Inject a monkey-patch that ONLY intercepts GET /api/snapshot
      const injectedPatch = `
        const __originalFetch = self.fetch.bind(self);
        self.fetch = async (resource, options) => {
          try {
            const fetchUrl = typeof resource === 'string' ? resource : resource.url;
            
            if (fetchUrl.includes('http://localhost:3000/api/snapshot')) {
              console.log('Worker fetch selectively patched by Playwright!');
              return new Response('[MOCKED_BY_INJECTED_SCRIPT] GET /api/snapshot', {
                status: 200,
                headers: { 'Content-Type': 'text/plain' }
              });
            }
            
            return await __originalFetch(resource, options);
          } catch (e) {
            console.error('Injected fetch error:', e.message);
            throw e;
          }
        };
      `;

      return route.fulfill({
        response,
        body: injectedPatch + '\n' + originalScript,
      });
    }

    // 2. Mock /api/snapshot for Main Thread and WebWorker
    if (url === 'http://localhost:3000/api/snapshot') {
      console.log('PLAYWRIGHT MOCKING SNAPSHOT!');
      return route.fulfill({
        status: 200,
        contentType: 'text/plain',
        body: '[MOCKED_BY_PLAYWRIGHT] GET /api/snapshot',
      });
    }

    // Pass everything else through (so the real server gets /api/status and /api/data)
    return route.continue();
  });

  const page = await context.newPage();

  page.on('console', msg => {
    console.log('PAGE CONSOLE:', msg.text());
  });

  page.on('pageerror', err => {
    console.log('PAGE ERROR:', err.message);
  });

  console.log('Navigating to local serve page...');
  await page.goto('http://localhost:8080');

  console.log('\n--- Clicking Main Fetch ---');
  await page.getByRole('button', { name: 'Main fetch' }).click();
  await page.waitForTimeout(1000);

  console.log('\n--- Clicking WebWorker Fetch ---');
  await page.getByRole('button', { name: 'WebWorker fetch' }).click();
  await page.waitForTimeout(1000);

  console.log('\n--- Clicking Native SharedWorker Fetch ---');
  await page.getByRole('button', { name: 'Native SharedWorker fetch' }).click();
  await page.waitForTimeout(1500);

  console.log('\n--- Clicking Blob Proxy SharedWorker Fetch ---');
  await page.getByRole('button', { name: 'Blob Proxy fetch' }).click();
  await page.waitForTimeout(1500);

  console.log('\n--- Final Output Content ---');
  const outText = await page.locator('#out').innerText();
  console.log(outText);
  console.log('----------------------------\n');

  console.log('Saving screenshot of the final state...');
  await page.screenshot({ path: 'final-state.png', fullPage: true });

  console.log('Keeping browser open. Close/stop the command execution when you are done.');
  await page.pause();
});
