# Playwright SharedWorker Interception

This project demonstrates how to selectively mock network (`fetch`) requests inside a `SharedWorker` using Playwright, while successfully bypassing the Chromium Opaque Origin security sandbox.

## The Problem
Playwright's `page.route()` can easily intercept the Main Thread and Dedicated WebWorkers. However, it cannot see network traffic inside `SharedWorkers` because they run in a global multi-context architecture outside of a single page's direct control.

If you attempt to intercept the `shared-worker.js` script download via Playwright's `route.fulfill()` and inject a monkey-patch, Chromium's security engine flags the script as tampered with. This strips its trusted origin and puts the worker in a `null` origin sandbox. As a result, while the mocked endpoint might succeed, all real cross-origin requests are blocked by strict CORS policies (`TypeError: Failed to fetch`).

## The Solution: Blob Proxy Injection
To defeat the sandbox with **zero changes to application code**, we use Playwright's `page.addInitScript()` to dynamically proxy the worker creation:

1. **Intercept Instantiation**: Silently override the `new SharedWorker()` constructor in the Main Thread.
2. **Fetch and Patch**: The Main Thread downloads the script over the network as raw text. Playwright's network interceptor successfully patches this download mid-air.
3. **Cleanse Origin via Blob**: The Main Thread takes the patched script and wraps it into a trusted `Blob URL`.
4. **Execute**: The worker boots from the trusted Blob URL instead of a suspicious network file.

Because the Blob URL was generated natively by the Main Thread, Chromium **fully trusts its origin**. No DevTools tampering flags, no null origins, and no CORS errors.

## Project Structure
- `public/index.html`: The UI testbed demonstrating the different worker threads.
- `tests/worker.spec.ts`: The Playwright test script implementing the network routing and the Blob Proxy injection.
- `presentation.html`: A beautifully animated, interactive slide deck detailing the architectural deep dive.

## Running the Tests
```bash
# Start the local development server
npm run serve

# Run the Playwright test suite
npx playwright test --headed
```
