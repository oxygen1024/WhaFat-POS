// Run after starting the local preview server:
// PLAYWRIGHT_MODULE=/absolute/path/to/playwright/index.mjs [CHROMIUM_PATH=/path/to/chrome] node tests/browser-smoke.mjs
import assert from 'node:assert/strict';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
const root = fileURLToPath(new URL('../', import.meta.url));
const output = path.join(root, 'tests/output/playwright');
await mkdir(output, { recursive: true });
const base = process.env.POS_TEST_URL || 'http://127.0.0.1:8766/';
const catalog = JSON.parse(await readFile(path.join(root, 'dist/data/catalog.json'), 'utf8'));
const product = catalog.products.find(p => p.id === 7077097472129);
const CART = 'wahfat-pos-cart-v1';
const ORDERS = 'wahfat-pos-orders-v1';
const results = [];
const browser = await chromium.launch(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH, headless: true } : { channel: 'chrome', headless: true });
const context = await browser.newContext({ viewport: { width: 1180, height: 820 }, timezoneId: 'Asia/Hong_Kong', hasTouch: true });
const page = await context.newPage();
const pageErrors = [];
const writes = [];
page.on('pageerror', error => pageErrors.push(error.message));
page.on('request', request => {
  if (!['GET', 'HEAD'].includes(request.method())) writes.push({ method: request.method(), url: request.url() });
});
const step = async (name, work) => {
  try { await work(); results.push({ name, passed: true }); console.log(`PASS ${name}`); }
  catch (error) { results.push({ name, passed: false, error: error.message }); console.error(`FAIL ${name}: ${error.message}`); throw error; }
};
const stored = async (key, target = page) => target.evaluate(k => JSON.parse(localStorage.getItem(k) || 'null'), key);
const loaded = async target => target.locator('[data-product]').first().waitFor();
const close = async target => target.locator('#modal-root [data-action="close-modal"]').first().click();
async function chooseProduct(target, selected = product) {
  await target.locator('#search').fill(selected.title);
  await target.locator(`[data-product="${selected.id}"]`).click();
}
async function add17w(target) {
  await chooseProduct(target);
  await target.locator('#add-product').click();
}
async function noOverflow(target) {
  const size = await target.evaluate(() => ({ viewport: innerWidth, body: document.body.scrollWidth, document: document.documentElement.scrollWidth }));
  assert.ok(size.body <= size.viewport + 1 && size.document <= size.viewport + 1, JSON.stringify(size));
}
async function isolated(work, options = {}) {
  const c = await browser.newContext({ viewport: { width: 1180, height: 820 }, serviceWorkers: 'block', timezoneId: 'Asia/Hong_Kong', ...options });
  try { await work(c); } finally { await c.close(); }
}

try {
  await step('Catalog loads with 299 products and source images', async () => {
    await page.goto(base);
    await loaded(page);
    assert.equal(await page.locator('#all-count').innerText(), String(catalog.products.length));
    assert.ok(await page.locator('[data-product] img[src*="cdn.shopify.com"]').count());
    await noOverflow(page);
  });
  await step('Actual 17w and 20w variant selections retain HK$226 and HK$262', async () => {
    await chooseProduct(page);
    assert.equal(await page.locator('.product-modal-copy .product-price').innerText(), 'HK$226.00');
    await page.locator('#add-product').click();
    await chooseProduct(page);
    await page.locator('[data-option="0"][data-option-value="20w"]').click();
    assert.equal(await page.locator('.product-modal-copy .product-price').innerText(), 'HK$262.00');
    await page.locator('#add-product').click();
    assert.equal(await page.locator('#total').innerText(), '$488.00');
    const cart = await stored(CART);
    assert.deepEqual(cart.items.map(item => [item.variantId, item.priceCents]), [[40971122311297, 22600], [40971122344065, 26200]]);
  });
  await step('Fixed discount and percent discount calculate correctly and survive reload', async () => {
    await page.locator('#discount-button').click();
    await page.locator('#discount-value').fill('10.10');
    await page.locator('#discount-form button[type="submit"]').click();
    assert.equal(await page.locator('#total').innerText(), '$477.90');
    await page.locator('#discount-button').click();
    await page.locator('#discount-type').selectOption('percent');
    await page.locator('#discount-value').fill('10');
    await page.locator('#discount-form button[type="submit"]').click();
    assert.equal(await page.locator('#total').innerText(), '$439.20');
    await page.reload();
    await loaded(page);
    assert.equal(await page.locator('#total').innerText(), '$439.20');
    assert.equal(await page.locator('#cart-count').innerText(), '2');
  });
  await step('Landscape, portrait and narrow layouts have no horizontal page overflow', async () => {
    await page.locator('#search').fill('');
    for (const [name, width, height] of [['ipad-landscape', 1180, 820], ['ipad-portrait', 820, 1180], ['phone', 390, 844]]) {
      await page.setViewportSize({ width, height });
      await noOverflow(page);
      await page.screenshot({ path: path.join(output, `${name}.png`) });
      if (width < 900) {
        await page.locator('#mobile-cart-button').click();
        await page.locator('#cart-panel.open').waitFor();
        await noOverflow(page);
        await page.screenshot({ path: path.join(output, `${name}-cart.png`) });
        await page.locator('#close-mobile-cart').click();
      }
    }
    await page.setViewportSize({ width: 1180, height: 820 });
  });
  await step('Insufficient cash is rejected; HK$500 tender returns HK$60.80', async () => {
    await page.locator('#checkout-button').click();
    await page.locator('#tendered').fill('400');
    await page.locator('#complete-sale').click();
    await page.locator('#payment-error:not([hidden])').waitFor();
    assert.equal((await stored(ORDERS))?.length || 0, 0);
    await page.locator('#tendered').fill('500');
    assert.equal(await page.locator('#change-amount').innerText(), 'HK$60.80');
    await page.screenshot({ path: path.join(output, 'cash-checkout.png') });
    // A synchronous repeated submit models an accidental fast double tap.
    await page.locator('#payment-form').evaluate(form => {
      form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
      form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    });
    await page.getByRole('heading', { name: '記錄已儲存' }).waitFor();
    const orders = await stored(ORDERS);
    assert.equal(orders.length, 1);
    assert.equal(orders[0].totalCents, 43920);
    assert.equal(orders[0].tenderedCents, 50000);
    assert.equal(orders[0].changeCents, 6080);
    assert.equal(orders[0].test, true);
    assert.equal((await stored(CART)).items.length, 0);
  });
  await step('Saved order persists; JSON and CSV export contain the exact sale', async () => {
    await page.reload(); await loaded(page);
    assert.equal((await stored(ORDERS)).length, 1);
    await page.locator('#history-button').click();
    assert.equal(await page.locator('[data-order]').count(), 1);
    const jsonDownload = page.waitForEvent('download');
    await page.locator('[data-action="export-json"]').click();
    const json = await jsonDownload;
    await json.saveAs(path.join(output, 'qa-backup.json'));
    const backup = JSON.parse(await readFile(path.join(output, 'qa-backup.json'), 'utf8'));
    assert.equal(backup.orders.length, 1);
    assert.equal(backup.orders[0].totalCents, 43920);
    const csvDownload = page.waitForEvent('download');
    await page.locator('[data-action="export-csv"]').click();
    await (await csvDownload).saveAs(path.join(output, 'qa-sales.csv'));
    const csv = await readFile(path.join(output, 'qa-sales.csv'), 'utf8');
    assert.ok(csv.includes('439.20') && csv.includes('226.00') && csv.includes('262.00'));
    await close(page);
  });
  await step('External payment requires manual confirmation and records no live charge', async () => {
    await add17w(page);
    await page.locator('#checkout-button').click();
    await page.locator('[data-payment="fps"]').click();
    await page.locator('#complete-sale').click();
    await page.locator('#payment-error:not([hidden])').waitFor();
    assert.equal((await stored(ORDERS)).length, 1);
    await page.locator('#payment-confirmed').check();
    await page.locator('#complete-sale').click();
    await page.getByRole('heading', { name: '記錄已儲存' }).waitFor();
    assert.equal((await stored(ORDERS)).length, 2);
    assert.equal((await stored(ORDERS))[0].paymentMethod, 'fps');
    assert.deepEqual(writes, []);
    await close(page);
  });
  await step('Sold-out zero price and positive review-price variants cannot be selected for sale', async () => {
    const unavailable = catalog.products.find(p => p.variants.every(v => !v.available));
    await chooseProduct(page, unavailable);
    assert.equal(await page.locator('#add-product').isDisabled(), true);
    await close(page);
    for (const p of catalog.products.filter(p => p.variants.some(v => v.priceReviewReason && v.priceCents > 0))) {
      await chooseProduct(page, p);
      for (const variant of p.variants.filter(v => v.priceReviewReason && v.priceCents > 0)) {
        const disabled = await page.locator('button[data-option="0"][data-option-value]').evaluateAll((buttons, value) => buttons.find(button => button.dataset.optionValue === value)?.disabled, variant.option1);
        assert.equal(disabled, true, `Review price variant ${variant.id}`);
      }
      await close(page);
    }
  });
  await step('Service worker caches shell and catalog for offline reload', async () => {
    await page.evaluate(async () => {
      await navigator.serviceWorker.ready;
      if (!navigator.serviceWorker.controller) await new Promise(resolve => navigator.serviceWorker.addEventListener('controllerchange', resolve, { once: true }));
    });
    const cache = await page.evaluate(async () => {
      const names = await caches.keys();
      const shell = await caches.open(names.find(name => name.endsWith('-shell')));
      return (await shell.keys()).map(request => new URL(request.url).pathname);
    });
    assert.ok(cache.includes('/data/catalog.json') && cache.includes('/app.js'));
    await context.setOffline(true);
    await page.reload(); await loaded(page);
    assert.equal(await page.locator('#all-count').innerText(), '299');
    assert.equal((await stored(ORDERS)).length, 2);
    await add17w(page);
    assert.equal(await page.locator('#total').innerText(), '$226.00');
    await page.screenshot({ path: path.join(output, 'offline.png') });
    await context.setOffline(false);
  });
  await step('Catalog load failure presents a retry message and disables checkout', async () => isolated(async c => {
    await c.route('**/data/catalog.json', route => route.fulfill({ status: 503, body: 'Unavailable' }));
    const p = await c.newPage(); await p.goto(base);
    await p.getByRole('heading', { name: '未能載入商品目錄' }).waitFor();
    assert.equal(await p.locator('#checkout-button').isDisabled(), true);
    assert.ok(await p.getByRole('button', { name: '重新載入', exact: true }).isVisible());
  }));
  await step('Quota failure preserves the cart and does not claim a completed sale', async () => isolated(async c => {
    await c.addInitScript(key => {
      const original = Storage.prototype.setItem;
      Storage.prototype.setItem = function(k, value) {
        if (k === key) throw new DOMException('QA simulated full storage', 'QuotaExceededError');
        return original.call(this, k, value);
      };
    }, ORDERS);
    const p = await c.newPage(); await p.goto(base); await loaded(p); await add17w(p);
    await p.locator('#checkout-button').click();
    await p.locator('#tendered').fill('300');
    await p.locator('#complete-sale').click();
    await p.locator('#payment-error:not([hidden])').waitFor();
    assert.match(await p.locator('#payment-error').innerText(), /未能保存/);
    assert.equal((await stored(CART, p)).items.length, 1);
    assert.equal(await stored(ORDERS, p), null);
    assert.equal(await p.getByRole('heading', { name: '記錄已儲存' }).count(), 0);
  }));
  await step('Malformed saved orders are preserved and block checkout', async () => isolated(async c => {
    const raw = JSON.stringify([{ id: 'BROKEN-ORDER', items: 'invalid', totalCents: 1 }]);
    await c.addInitScript(({ key, raw }) => localStorage.setItem(key, raw), { key: ORDERS, raw });
    const p = await c.newPage(); await p.goto(base); await loaded(p);
    assert.equal(await p.evaluate(key => localStorage.getItem(key), ORDERS), raw);
    assert.equal(await p.locator('#storage-warning').isVisible(), true);
    assert.equal(await p.locator('#checkout-button').isDisabled(), true);
  }));
  await step('A legacy cart without a discount recovers without breaking rendering', async () => isolated(async c => {
    const variant = product.variants[0];
    const cart = { id: 'QA-LEGACY', items: [{ productId: product.id, variantId: variant.id, priceCents: variant.priceCents, quantity: 1 }] };
    await c.addInitScript(({ key, cart }) => localStorage.setItem(key, JSON.stringify(cart)), { key: CART, cart });
    const p = await c.newPage(); await p.goto(base); await loaded(p);
    assert.equal(await p.locator('#total').innerText(), '$226.00');
    assert.equal(await p.locator('#checkout-button').isDisabled(), false);
    assert.ok((await stored(CART, p)).discount);
  }));
  await step('No unhandled application errors occur during the main workflow', async () => {
    assert.deepEqual(pageErrors, []);
  });
} catch {
  process.exitCode = 1;
} finally {
  await writeFile(path.join(output, 'browser-results.json'), JSON.stringify({
    checkedAt: new Date().toISOString(), browser: 'Chrome via Playwright, emulated viewport and touch; not a physical iPad',
    base, results, pageErrors, outgoingWrites: writes,
  }, null, 2));
  await browser.close();
}
