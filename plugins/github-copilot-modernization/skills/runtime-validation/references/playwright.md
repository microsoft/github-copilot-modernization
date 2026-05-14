# Playwright E2E Testing

Use when the migrated app has a browser-rendered UI that users interact with.

## Environment Prerequisites

- Node.js 18+ installed
- Chrome/Chromium available (or let Playwright download it)

```bash
# First time setup
npm init playwright@latest   # scaffold config, first test, CI
npx playwright install       # download browsers (chromium/firefox/webkit)
npx playwright install-deps  # install OS-level browser deps (Linux CI only)
```

Verify:
```bash
npx playwright --version
```

## Generate Tests

```bash
npx playwright codegen <url>       # record by clicking
npx playwright test --ui           # interactive mode
```

## Write Tests (TypeScript)

```typescript
import { test, expect } from '@playwright/test';

test('happy-path: <flow name>', async ({ page }) => {
  await page.goto('http://localhost:8080');
  await page.getByRole('button', { name: 'Submit' }).click();
  await expect(page).toHaveURL(/success/);
  await page.screenshot({ path: 'evidence/happy-path.png' });
});
```

## Run & Collect Evidence

```bash
npx playwright test                          # run all
npx playwright test --reporter=html          # HTML report → playwright-report/
npx playwright test --reporter=json > results.json
```

Evidence for verdict:
- Exit code (0 = pass)
- `playwright-report/index.html` — full report
- `test-results/` — failure screenshots/videos

## Key Rules

- Prefer `getByRole()` / `getByText()` over CSS selectors
- Screenshot on failure is required evidence
- If no browser journey exists, use REST Assured instead
