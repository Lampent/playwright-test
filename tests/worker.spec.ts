import { test, expect } from '@playwright/test'; // Import Playwright testing functions
import http from 'http'; // Import Node.js built-in HTTP module

let server: http.Server; // Declare a variable to store the mock API server instance

// Setup function executed before all tests in this suite
test.beforeAll(async () => {
  // Create an HTTP server on localhost to mimic our real backend API
  server = http.createServer((req, res) => {
    // Send a 200 OK header with permissive CORS headers to allow cross-origin requests
    res.writeHead(200, {
      'Content-Type': 'text/plain',
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Headers': '*',
      'Access-Control-Allow-Methods': '*'
    });
    // Respond to preflight OPTIONS requests immediately
    if (req.method === 'OPTIONS') {
      res.end();
      return;
    }
    // For other requests, return a text identifying the endpoint and HTTP method hit
    res.end(`[REAL_SERVER] ${req.method} ${req.url}`);
  });

  // Start the server listening on port 3000
  await new Promise<void>((resolve) => {
    server.listen(3000, resolve);
  });
});

// Teardown function executed after all tests finish
test.afterAll(async () => {
  // Gracefully close the mock API server
  await new Promise<void>((resolve) => {
    server.close(() => resolve());
  });
});

// Define the Playwright test case
test('Selective Network Mocking using Route Fulfill and Script Patching', async ({ browser }) => {
  // Create a brand new isolated browser context for this test
  const context = await browser.newContext();

  // Inject initialization script into the page before it loads
  await context.addInitScript(() => {
    // @ts-ignore
    // Register a custom constructor window.BlobProxiedSharedWorker to override SharedWorker instantiation
    window.BlobProxiedSharedWorker = function(workerUrl: string) {
      // Create a message channel to communicate between the page and the proxied worker
      const channel = new MessageChannel();
      
      // Fetch the worker script text over the page's network context
      fetch(workerUrl)
        .then(res => res.text()) // Extract the script content as plain text
        .then(scriptText => {
          // Wrap the modified script text into a Blob with javascript content-type
          const blob = new Blob([scriptText], { type: 'application/javascript' });
          // Generate a local object blob URL pointing to this script in memory
          const blobUrl = URL.createObjectURL(blob);
          
          // Instantiate the native SharedWorker using the safe, local blob URL
          const realWorker = new window.SharedWorker(blobUrl);
          
          // Relay incoming worker port messages to the proxy channel's port1
          realWorker.port.onmessage = (e) => channel.port1.postMessage(e.data);
          // Relay incoming proxy channel port1 messages to the worker's port
          channel.port1.onmessage = (e) => realWorker.port.postMessage(e.data);
          
          // Start the port transmission for the real worker
          realWorker.port.start();
        });
        
      // Return the wrapper port object matching the standard SharedWorker structure
      return { port: channel.port2 };
    };
  });

  // Set up Playwright's network routing to intercept all network requests
  await context.route('**/*', async (route) => {
    const req = route.request(); // Retrieve the request object
    const url = req.url(); // Retrieve the URL string of the request

    // Log every request that Playwright intercepts in the test console
    console.log('PLAYWRIGHT SAW ROUTE:', req.method(), url);

    // If the request is for the SharedWorker script, intercept and patch it
    if (url.endsWith('/shared-worker.js')) {
      const response = await route.fetch(); // Let the request go to the server to get the script
      const originalScript = await response.text(); // Retrieve the original script code as text

      // Define the self.fetch monkey patch string
      const injectedPatch = `
        const __originalFetch = self.fetch.bind(self); // Store reference to original self.fetch
        self.fetch = async (resource, options) => { // Override self.fetch globally inside the worker
          try {
            // Get the URL string of the worker's fetch target
            const fetchUrl = typeof resource === 'string' ? resource : resource.url;
            
            // If the target is the snapshot endpoint, mock it locally
            if (fetchUrl.includes('http://localhost:3000/api/snapshot')) {
              console.log('Worker fetch selectively patched by Playwright!');
              return new Response('[MOCKED_BY_INJECTED_SCRIPT] GET /api/snapshot', {
                status: 200,
                headers: { 'Content-Type': 'text/plain' }
              });
            }
            
            // Otherwise, forward it to the native fetch API
            return await __originalFetch(resource, options);
          } catch (e) {
            console.error('Injected fetch error:', e.message);
            throw e;
          }
        };
      `;

      // Fulfill the script request by joining the injected patch and the original script
      return route.fulfill({
        response,
        body: injectedPatch + '\n' + originalScript,
      });
    }

    // If the request is for the snapshot endpoint from page/dedicated worker, mock it directly
    if (url === 'http://localhost:3000/api/snapshot') {
      console.log('PLAYWRIGHT MOCKING SNAPSHOT!');
      return route.fulfill({
        status: 200,
        contentType: 'text/plain',
        body: '[MOCKED_BY_PLAYWRIGHT] GET /api/snapshot',
      });
    }

    // Continue all other network requests normally (without routing interception)
    return route.continue();
  });

  // Open a new browser page in our configured context
  const page = await context.newPage();

  // Listen to console messages printed inside the browser page
  page.on('console', msg => {
    console.log('PAGE CONSOLE:', msg.text());
  });

  // Listen to page errors / unhandled exceptions occurring inside the browser page
  page.on('pageerror', err => {
    console.log('PAGE ERROR:', err.message);
  });

  // Log page navigation start
  console.log('Navigating to local serve page...');
  // Navigate to the local server
  await page.goto('http://localhost:8080');

  // Log clicking of Main Fetch button
  console.log('\n--- Clicking Main Fetch ---');
  // Click the 'Main fetch' button
  await page.getByRole('button', { name: 'Main fetch' }).click();
  // Wait for 1 second to let requests execute and response populate
  await page.waitForTimeout(1000);

  // Log clicking of WebWorker Fetch button
  console.log('\n--- Clicking WebWorker Fetch ---');
  // Click the 'WebWorker fetch' button
  await page.getByRole('button', { name: 'WebWorker fetch' }).click();
  // Wait for 1 second for worker response to render
  await page.waitForTimeout(1000);

  // Log clicking of Native SharedWorker Fetch button
  console.log('\n--- Clicking Native SharedWorker Fetch ---');
  // Click the 'Native SharedWorker fetch' button
  await page.getByRole('button', { name: 'Native SharedWorker fetch' }).click();
  // Wait for 1.5 seconds for native SharedWorker fetches to fail/succeed
  await page.waitForTimeout(1500);

  // Log clicking of Blob Proxy Fetch button
  console.log('\n--- Clicking Blob Proxy SharedWorker Fetch ---');
  // Click the 'Blob Proxy fetch' button
  await page.getByRole('button', { name: 'Blob Proxy fetch' }).click();
  // Wait for 1.5 seconds for the proxied SharedWorker to execute and render
  await page.waitForTimeout(1500);

  // Log printing final state output
  console.log('\n--- Final Output Content ---');
  // Retrieve the inner text from the output log box `#out`
  const outText = await page.locator('#out').innerText();
  // Print the log box contents in the test console
  console.log(outText);
  console.log('----------------------------\n');

  // Log saving of final state screenshot
  console.log('Saving screenshot of the final state...');
  // Capture a screenshot of the final page state
  await page.screenshot({ path: 'final-state.png', fullPage: true });

  // Log browser pausing
  console.log('Keeping browser open. Close/stop the command execution when you are done.');
  // Pause the test execution, leaving the headed browser open
  await page.pause();
});
