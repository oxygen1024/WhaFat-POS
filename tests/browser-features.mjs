// Covers search clear, the searchable variant picker, favourites, held orders, notes, void/refund and the daily report.
// Start the preview server first (npm start serves dist/ on 8765; POS_TEST_URL overrides it), then:
// PLAYWRIGHT_MODULE=/absolute/path/to/playwright/index.mjs CHROMIUM_PATH=/path/to/chrome node tests/browser-features.mjs
import assert from 'node:assert/strict';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
const root = fileURLToPath(new URL('../', import.meta.url));
const output = path.join(root, 'tests/output/playwright');
await mkdir(output, { recursive: true });
const base = process.env.POS_TEST_URL || 'http://127.0.0.1:8765/';
const catalog = JSON.parse(await readFile(path.join(root, 'dist/data/catalog.json'), 'utf8'));
const plain = catalog.products.find(p => p.id === 7077097472129);
const switches = catalog.products.find(p => p.id === 6903579115649);
const label = v => v.option1;
const byLabel = text => switches.variants.find(v => label(v) === text);
const ORDERS = 'wahfat-pos-orders-v1';
const FAVORITES = 'wahfat-pos-favorites-v1';
const HELD = 'wahfat-pos-held-v1';
const hkToday = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Hong_Kong' }).format(new Date());
const results = [];
const browser = await chromium.launch(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH, headless: true } : { channel: 'chrome', headless: true });
const context = await browser.newContext({ viewport: { width: 1180, height: 820 }, timezoneId: 'Asia/Hong_Kong', serviceWorkers: 'block', hasTouch: true, acceptDownloads: true });
const page = await context.newPage();
const pageErrors = [];
page.on('pageerror', error => pageErrors.push(error.message));
const step = async (name, work) => {
  try { await work(); results.push({ name, passed: true }); console.log(`PASS ${name}`); }
  catch (error) { results.push({ name, passed: false, error: error.message }); console.error(`FAIL ${name}: ${error.stack}`); throw error; }
};
const stored = key => page.evaluate(k => JSON.parse(localStorage.getItem(k) || 'null'), key);
const closeModal = () => page.locator('#modal-root [data-action="close-modal"]').first().click();
const money = cents => 'HK$' + (cents / 100).toLocaleString('en-HK', { minimumFractionDigits: 2 });
async function openSwitches() {
  await page.locator('#search').fill(switches.title);
  await page.locator(`[data-product="${switches.id}"]`).click();
  await page.locator('#vp-list').waitFor();
}
async function noOverflow() {
  const size = await page.evaluate(() => ({ viewport: innerWidth, body: document.body.scrollWidth, document: document.documentElement.scrollWidth }));
  assert.ok(size.body <= size.viewport + 1 && size.document <= size.viewport + 1, JSON.stringify(size));
}

try {
  await step('Catalog loads', async () => {
    await page.goto(base);
    await page.locator('[data-product]').first().waitFor();
    assert.equal(await page.locator('#product-count').innerText(), String(catalog.products.length));
  });

  await step('Search box shows a clear button that empties it, restores results and refocuses; Escape does the same', async () => {
    assert.equal(await page.locator('#search-clear').isHidden(), true);
    await page.locator('#search').fill('Philips');
    assert.equal(await page.locator('#search-clear').isVisible(), true);
    const filtered = Number(await page.locator('#product-count').innerText());
    assert.ok(filtered > 0 && filtered < catalog.products.length);
    await page.locator('#search-clear').click();
    assert.equal(await page.locator('#search').inputValue(), '');
    assert.equal(await page.locator('#product-count').innerText(), String(catalog.products.length));
    assert.equal(await page.locator('#search-clear').isHidden(), true);
    assert.equal(await page.evaluate(() => document.activeElement.id), 'search');
    await page.locator('#search').fill('Philips');
    await page.locator('#search').press('Escape');
    assert.equal(await page.locator('#search').inputValue(), '');
  });

  await step('Several search words match in any order', async () => {
    await page.locator('#search').fill('西門子 arina');
    const forward = await page.locator('#product-count').innerText();
    await page.locator('#search').fill('ARINA 西門子');
    assert.equal(await page.locator('#product-count').innerText(), forward);
    assert.ok(Number(forward) > 0);
    await page.locator('#search-clear').click();
  });

  await step('Variant picker lists all 48 switch types with prices and filters by several words', async () => {
    await openSwitches();
    assert.equal(await page.locator('#vp-count').innerText(), '共 48 款');
    assert.equal(await page.locator('#vp-list .variant-row').count(), switches.variants.length);
    assert.equal(await page.locator('select[data-option]').count(), 0);
    await page.locator('#vp-search').fill('雙控 led');
    const expected = switches.variants.filter(v => ['雙控', 'led'].every(t => label(v).toLowerCase().includes(t)));
    assert.ok(expected.length > 1 && expected.length < switches.variants.length);
    assert.equal(await page.locator('#vp-list .variant-row').count(), expected.length);
    assert.equal(await page.locator('#vp-count').innerText(), `${expected.length} / 48 款`);
    assert.ok(await page.locator('#vp-list mark').count() >= expected.length);
    assert.equal(await page.evaluate(() => document.activeElement.id), 'vp-search');
    await page.screenshot({ path: path.join(output, 'variant-picker.png') });
  });

  await step('Quick keyword tags and the clear button change the filter', async () => {
    await page.locator('#vp-clear').click();
    assert.equal(await page.locator('#vp-search').inputValue(), '');
    assert.equal(await page.locator('#vp-list .variant-row').count(), 48);
    await page.locator('[data-vp-tag="三位"]').click();
    const three = switches.variants.filter(v => label(v).includes('三位')).length;
    assert.equal(await page.locator('#vp-list .variant-row').count(), three);
    assert.equal(await page.locator('[data-vp-tag="三位"]').getAttribute('aria-pressed'), 'true');
    await page.locator('[data-vp-tag="三位"]').click();
    assert.equal(await page.locator('#vp-list .variant-row').count(), 48);
    await page.locator('#vp-search').fill('不存在的款式');
    await page.locator('.vp-empty').waitFor();
    await page.locator('#vp-clear-empty').click();
    assert.equal(await page.locator('#vp-list .variant-row').count(), 48);
  });

  await step('Choosing a row shows its exact variant and price; add-and-continue keeps the modal open', async () => {
    const first = byLabel('兩位雙控連led指示燈'), second = byLabel('單位單控');
    await page.locator(`.variant-row-main[data-option-value="${label(first)}"]`).click();
    assert.equal(await page.locator('.selected-variant b').innerText(), label(first));
    assert.equal(await page.locator('.product-modal-copy .product-price').innerText(), money(first.priceCents));
    await page.locator('[data-action="product-plus"]').click();
    await page.locator('[data-action="add-keep"]').click();
    assert.equal(await page.locator('#modal-root .modal').count(), 1);
    assert.equal(await page.locator('#product-quantity').innerText(), '1');
    await page.locator(`.variant-row-main[data-option-value="${label(second)}"]`).click();
    await page.locator('[data-action="add-product"]').click();
    assert.equal(await page.locator('#modal-root .modal').count(), 0);
    assert.equal(await page.locator('#cart-count').innerText(), '3');
    const total = first.priceCents * 2 + second.priceCents;
    assert.equal(await page.locator('#subtotal').innerText(), money(total));
  });

  await step('Opening a product while searching pre-filters its variant list', async () => {
    await page.locator('#search').fill('雙控');
    await page.locator(`[data-product="${switches.id}"]`).click();
    assert.equal((await page.locator('#vp-search').inputValue()).trim(), '雙控');
    assert.equal(await page.locator('#vp-list .variant-row').count(), switches.variants.filter(v => label(v).includes('雙控')).length);
    assert.match(await page.locator('.selected-variant b').innerText(), /雙控/);
    await closeModal();
    await page.locator('#search-clear').click();
  });

  await step('Favourite variants appear in a quick bar, persist, add straight to the order and can be removed', async () => {
    const star = byLabel('單位單控');
    await openSwitches();
    await page.locator(`.fav-toggle[data-fav-variant="${star.id}"]`).click();
    assert.equal(await page.locator(`.fav-toggle[data-fav-variant="${star.id}"]`).getAttribute('aria-pressed'), 'true');
    await closeModal();
    await page.locator(`[data-fav-add="${star.id}"]`).waitFor();
    assert.deepEqual(await stored(FAVORITES), [star.id]);
    await page.reload(); await page.locator('[data-product]').first().waitFor();
    assert.equal(await page.locator(`[data-fav-add="${star.id}"]`).isVisible(), true);
    const before = Number(await page.locator('#cart-count').innerText());
    await page.locator(`[data-fav-add="${star.id}"]`).click();
    assert.equal(Number(await page.locator('#cart-count').innerText()), before + 1);
    await page.locator('#cart-panel [data-cart-remove]').first().waitFor();
    await noOverflow();
    await page.screenshot({ path: path.join(output, 'favorites-bar.png') });
    await page.locator(`[data-fav-remove="${star.id}"]`).click();
    assert.equal(await page.locator('#favorites-bar').isHidden(), true);
    assert.deepEqual(await stored(FAVORITES), []);
  });

  await step('The favourite star also works from the modal header', async () => {
    await page.locator('#search').fill(plain.title);
    await page.locator(`[data-product="${plain.id}"]`).click();
    await page.locator('[data-action="toggle-fav"]').click();
    assert.equal(await page.locator('[data-action="toggle-fav"]').getAttribute('aria-pressed'), 'true');
    await closeModal();
    assert.deepEqual(await stored(FAVORITES), [plain.variants[0].id]);
    await page.locator(`[data-fav-remove="${plain.variants[0].id}"]`).click();
    await page.locator('#search-clear').click();
  });

  await step('An order can be held, another served, and the held order brought back (swapping the current one)', async () => {
    assert.equal(await page.locator('#hold-button').isDisabled(), false);
    const held = await page.locator('#subtotal').innerText();
    await page.locator('#hold-button').click();
    assert.equal(await page.locator('#cart-count').innerText(), '0');
    assert.equal(await page.locator('#held-count').innerText(), '1');
    assert.equal(await page.locator('#hold-button').isDisabled(), true);
    await page.locator('#search').fill(plain.title);
    await page.locator(`[data-product="${plain.id}"]`).click();
    await page.locator('#add-product').click();
    await page.locator('#search-clear').click();
    assert.equal(await page.locator('#subtotal').innerText(), 'HK$226.00');
    await page.locator('#held-button').click();
    await page.locator('[data-held-resume]').click();
    assert.equal(await page.locator('#subtotal').innerText(), held);
    assert.equal(await page.locator('#held-count').innerText(), '1');
    const remaining = await stored(HELD);
    assert.equal(remaining.length, 1);
    assert.equal(remaining[0].items[0].title, plain.title);
    await page.locator('#held-button').click();
    const discard = page.locator('[data-held-delete]');
    await discard.click();
    assert.equal(await page.locator('[data-held-delete]').innerText(), '確定刪除？');
    assert.equal((await stored(HELD)).length, 1);
    await page.locator('[data-held-delete]').click();
    assert.equal((await stored(HELD)).length, 0);
    assert.equal(await page.locator('#held-count').innerText(), '0');
    await closeModal();
  });

  await step('Held order survives a reload', async () => {
    await page.locator('#hold-button').click();
    await page.reload(); await page.locator('[data-product]').first().waitFor();
    assert.equal(await page.locator('#held-count').innerText(), '1');
    await page.locator('#held-button').click();
    await page.locator('[data-held-resume]').click();
    assert.equal(await page.locator('#held-count').innerText(), '0');
    assert.ok(Number(await page.locator('#cart-count').innerText()) > 0);
  });

  await step('Customer details and a note are saved with the cart, receipt and history', async () => {
    await page.locator('#note-button').click();
    await page.locator('#customer-name').fill('陳先生');
    await page.locator('#customer-phone').fill('9123 4567');
    await page.locator('#order-note').fill('星期五送貨\n預留兩套');
    await page.locator('#note-form button[type="submit"]').click();
    assert.match(await page.locator('#cart-memo').innerText(), /陳先生 · 9123 4567/);
    await page.reload(); await page.locator('[data-product]').first().waitFor();
    assert.match(await page.locator('#cart-memo').innerText(), /陳先生/);
    await page.locator('#checkout-button').click();
    await page.locator('#tendered').fill('9999');
    await page.locator('#complete-sale').click();
    await page.getByRole('heading', { name: '記錄已儲存' }).waitFor();
    const [order] = await stored(ORDERS);
    assert.deepEqual(order.customer, { name: '陳先生', phone: '9123 4567' });
    assert.equal(order.note, '星期五送貨\n預留兩套');
    assert.equal(await page.locator('#cart-memo').isHidden(), true);
    await closeModal();
    await page.locator('#history-button').click();
    assert.match(await page.locator('.order-row').first().innerText(), /陳先生/);
    await page.locator('.order-row').first().click();
    const receipt = await page.locator('.receipt').innerText();
    assert.ok(receipt.includes('客戶：陳先生') && receipt.includes('電話：9123 4567') && receipt.includes('預留兩套'));
    await closeModal();
  });

  await step('A second sale paid by FPS is recorded for the report', async () => {
    await page.locator('#search').fill(plain.title);
    await page.locator(`[data-product="${plain.id}"]`).click();
    await page.locator('#add-product').click();
    await page.locator('#search-clear').click();
    await page.locator('#checkout-button').click();
    await page.locator('[data-payment="fps"]').click();
    await page.locator('#payment-confirmed').check();
    await page.locator('#complete-sale').click();
    await page.getByRole('heading', { name: '記錄已儲存' }).waitFor();
    assert.equal((await stored(ORDERS)).length, 2);
    await closeModal();
  });

  await step('Voiding needs the confirmation box and a reason, then keeps the order but marks it', async () => {
    await page.locator('#history-button').click();
    await page.locator('.order-row').first().click();
    await page.locator('[data-void-order]').click();
    await page.locator('#void-reason').fill('顧客取消');
    await page.locator('#void-form button[type="submit"]').click();
    await page.locator('#void-error:not([hidden])').waitFor();
    assert.equal((await stored(ORDERS)).filter(o => o.status).length, 0);
    await page.locator('#void-confirm').check();
    await page.locator('#void-form button[type="submit"]').click();
    await page.locator('.receipt-void').waitFor();
    const orders = await stored(ORDERS);
    assert.equal(orders.length, 2);
    assert.equal(orders[0].status, 'voided');
    assert.equal(orders[0].voidReason, '顧客取消');
    assert.equal(orders[0].paymentMethod, 'fps');
    assert.equal(await page.locator('[data-void-order]').count(), 0);
    await page.locator('[data-action="history"]').click();
    assert.equal(await page.locator('.status-badge').count(), 1);
    await closeModal();
  });

  await step('A refund on the other order records its type and cannot be repeated', async () => {
    await page.locator('#history-button').click();
    await page.locator('.order-row:not(.is-void)').first().click();
    await page.locator('[data-void-order]').click();
    await page.locator('input[name="void-type"][value="refund"]').check();
    await page.locator('#void-reason').fill('退貨');
    await page.locator('#void-confirm').check();
    await page.locator('#void-form button[type="submit"]').click();
    await page.locator('.receipt-void').waitFor();
    const orders = await stored(ORDERS);
    assert.deepEqual(orders.map(o => o.status), ['voided', 'refunded']);
    assert.match(await page.locator('.receipt-void').innerText(), /已退款/);
    assert.equal(await page.locator('[data-void-order]').count(), 0);
    await closeModal();
  });

  await step('Reload keeps voided orders readable (stored data still validates)', async () => {
    await page.reload(); await page.locator('[data-product]').first().waitFor();
    assert.equal(await page.locator('#storage-warning').isHidden(), true);
    assert.equal(await page.locator('#checkout-button').isDisabled(), true);
  });

  await step('Daily report nets voids and refunds off today and exports the figures', async () => {
    await page.locator('#report-button').click();
    assert.equal(await page.locator('#report-date').inputValue(), hkToday);
    const orders = await stored(ORDERS);
    const gross = orders.reduce((sum, o) => sum + o.totalCents, 0);
    assert.match(await page.locator('.report-tile.main').innerText(), /HK\$0\.00/);
    const tiles = await page.locator('.report-tile').allInnerTexts();
    assert.ok(tiles.some(t => t.includes(money(gross))), tiles.join('|'));
    assert.ok(tiles.some(t => t.includes('2 張')));
    assert.ok((await page.locator('.report-table').first().innerText()).includes('轉數快'));
    assert.equal(await page.locator('.report-voids li').count(), 2);
    await page.screenshot({ path: path.join(output, 'daily-report.png') });
    const download = page.waitForEvent('download');
    await page.locator('[data-action="report-csv"]').click();
    await (await download).saveAs(path.join(output, 'qa-daily.csv'));
    const csv = await readFile(path.join(output, 'qa-daily.csv'), 'utf8');
    assert.ok(csv.includes(`日結報表,"${hkToday}"`) || csv.includes(hkToday));
    assert.ok(csv.includes('淨銷售額 HKD') && csv.includes('0.00') && csv.includes('顧客取消'));
    await page.locator('[data-report-shift="-1"]').click();
    await page.locator('.empty-results').waitFor();
    await page.locator('[data-report-today]').click();
    assert.equal(await page.locator('#report-date').inputValue(), hkToday);
    await closeModal();
  });

  await step('Sales CSV carries status, customer, note and void columns', async () => {
    await page.locator('#history-button').click();
    const download = page.waitForEvent('download');
    await page.locator('[data-action="export-csv"]').click();
    await (await download).saveAs(path.join(output, 'qa-sales-features.csv'));
    const csv = await readFile(path.join(output, 'qa-sales-features.csv'), 'utf8');
    for (const text of ['訂單狀態', '已作廢', '已退款', '陳先生', '9123 4567', '顧客取消', '退貨']) assert.ok(csv.includes(text), text);
    await closeModal();
  });

  await step('Layouts stay inside the viewport with favourites, picker and report open', async () => {
    const star = byLabel('單位單控');
    await page.locator('#search').fill(switches.title);
    await page.locator(`[data-product="${switches.id}"]`).click();
    await page.locator(`.fav-toggle[data-fav-variant="${star.id}"]`).click();
    await closeModal();
    await page.locator('#search-clear').click();
    for (const [name, width, height] of [['ipad-landscape', 1180, 820], ['ipad-portrait', 820, 1180], ['phone', 390, 844]]) {
      await page.setViewportSize({ width, height });
      await noOverflow();
      await page.locator('#search').fill(switches.title);
      await page.locator(`[data-product="${switches.id}"]`).click();
      await page.locator('#vp-list').waitFor();
      await noOverflow();
      await page.screenshot({ path: path.join(output, `features-picker-${name}.png`) });
      await closeModal();
      await page.locator('#search-clear').click();
      await page.locator('#report-button').click();
      await noOverflow();
      await page.screenshot({ path: path.join(output, `features-report-${name}.png`) });
      await closeModal();
    }
    await page.setViewportSize({ width: 1180, height: 820 });
  });

  await step('No unhandled application errors occurred', async () => {
    assert.deepEqual(pageErrors, []);
  });
} catch {
  process.exitCode = 1;
} finally {
  await writeFile(path.join(output, 'browser-features-results.json'), JSON.stringify({ checkedAt: new Date().toISOString(), base, results, pageErrors }, null, 2));
  await browser.close();
}
